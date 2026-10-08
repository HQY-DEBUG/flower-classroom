"""Build and verify the genuine folder-only distribution from win-unpacked."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--seven-zip', required=True)
parser.add_argument('--dist-dir', default='dist-rc16-final')
parser.add_argument('--out', required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
dist = repo / args.dist_dir
output = Path(args.out).resolve()
output.mkdir(parents=True, exist_ok=True)
version = json.loads((repo / 'package.json').read_text())['version']
source = dist / 'win-unpacked'
standard_zip = dist / f'FlowerClassroom-{version}-x64.zip'
target = output / f'FlowerClassroom-{version}-folder.7z'
qa = repo / 'artifacts/rc16/package'
qa.mkdir(parents=True, exist_ok=True)
top_folder = '花伴课堂'
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()


def inventory(root):
    files = {}
    directories = set()
    for file in sorted(root.rglob('*')):
        assert not file.is_symlink(), f'Unexpected linked path: {file}'
        relative = file.relative_to(root).as_posix()
        if file.is_dir():
            directories.add(relative)
        else:
            assert file.is_file(), f'Unexpected non-file path: {file}'
            files[relative] = {'sizeBytes': file.stat().st_size, 'sha256': sha(file)}
    return files, directories


def verify_resources(root):
    # Build helper checks exact original-avatar bytes, initial unbound XLSX,
    # parser-valid config, empty data/backup and no root Markdown documents.
    script = "const x=require('./scripts/prepare-folder-resources.cjs').verifyFolderResources(process.argv[1]); console.log(JSON.stringify(x));"
    checked = subprocess.run(['node', '-e', script, str(root)], cwd=repo, check=True, capture_output=True, text=True)
    return json.loads(checked.stdout)


source_files, source_dirs = inventory(source)
assert not any(name.lower().endswith('.md') for name in source_files), 'Loose Markdown files must not be distributed'
assert all(name in source_files for name in ['花伴课堂.exe', 'resources/app.asar', '配置.txt', '计分卡片.xlsx'])
assert (source / '花伴课堂.exe').read_bytes()[:2] == b'MZ', 'Expected real Windows runtime executable'
source_resources = verify_resources(source)
zip_sha256 = sha(standard_zip)
with zipfile.ZipFile(standard_zip) as archive:
    assert archive.testzip() is None, 'Standard ZIP failed CRC verification'
    zip_files = {item.filename: {'sizeBytes': item.file_size, 'sha256': hashlib.sha256(archive.read(item)).hexdigest()}
                 for item in archive.infolist() if not item.is_dir()}
    zip_dirs = {item.filename.rstrip('/') for item in archive.infolist() if item.is_dir()}
    assert zip_files == source_files, 'Standard ZIP and win-unpacked file names/bytes differ'
    assert zip_dirs == source_dirs, 'Standard ZIP must include all directories, including empty 数据/备份'
assert sha(standard_zip) == zip_sha256, 'Standard ZIP changed during verification'

logs = []
with tempfile.TemporaryDirectory(prefix='flower-rc16-folder-only-') as temporary:
    temporary = Path(temporary)
    staging = temporary / 'staging'
    staging.mkdir()
    shutil.copytree(source, staging / top_folder)
    assert inventory(staging / top_folder) == (source_files, source_dirs)
    archive_file = temporary / 'folder.7z'

    def seven_zip(*arguments, cwd=None):
        command = [str(Path(args.seven_zip).resolve()), *map(str, arguments)]
        completed = subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)
        logs.append('$ ' + ' '.join(command) + '\n' + completed.stdout + completed.stderr)
        return completed.stdout

    seven_zip('a', '-t7z', '-m0=lzma2', '-mx=9', '-md=128m', '-mfb=273', '-ms=on', '-mmt=2', archive_file, top_folder, cwd=staging)
    assert archive_file.read_bytes()[:6] == b"7z\xbc\xaf'\x1c", 'Expected a genuine 7z archive'
    seven_zip('t', archive_file)
    seven_zip('l', '-slt', archive_file)
    extracted = temporary / 'extracted'
    seven_zip('x', '-y', f'-o{extracted}', archive_file)
    assert [file.name for file in extracted.iterdir()] == [top_folder], 'Archive must have one top-level application folder'
    payload = extracted / top_folder
    payload_files, payload_dirs = inventory(payload)
    assert payload_files == source_files, '7z payload names/bytes differ from win-unpacked'
    assert payload_dirs == source_dirs, '7z payload lost a directory'
    resources = verify_resources(payload)
    assert resources['avatarCount'] == 120
    assert archive_file.stat().st_size < 100 * 1024 * 1024, 'The archive must be under 100 MiB'
    assert inventory(source) == (source_files, source_dirs), 'Runtime payload changed while archiving'
    assert sha(standard_zip) == zip_sha256, 'Standard ZIP changed while archiving'
    shutil.copy2(archive_file, target)
    assert sha(target) == sha(archive_file)

result = {
    'version': version, 'status': 'passed', 'verifiedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'file': str(target), 'sizeBytes': target.stat().st_size, 'sha256': sha(target),
    'true7z': True, 'format': '7z', 'compression': 'LZMA2', 'dictionaryMiB': 128, 'compressionLevel': 9,
    'topLevelFolder': top_folder, 'crcPassed': True, 'under100MiB': True,
    'source': str(source), 'standardZip': str(standard_zip), 'standardZipSha256': zip_sha256,
    'unpackedFilesExactlyMatched': len(source_files), 'zipFilesExactlyMatched': len(zip_files),
    'directoriesExactlyMatched': sorted(source_dirs), 'emptyDirectoriesPreserved': ['数据', '备份'],
    'avatarCount': 120, 'allAvatarOriginalHashesMatched': True, 'configParserValidated': True,
    'initialWorkbookSha256': source_resources['workbookSha256'],
    'asarSha256': source_files['resources/app.asar']['sha256'],
    'runtimeExeSha256': source_files['花伴课堂.exe']['sha256'],
    'looseMarkdownCount': 0, 'files': source_files, 'windowsExecuted': False,
    'notes': 'Built directly from the folder runtime. No portable wrapper executable was used.'
}
(qa / 'folder7z-integrity.txt').write_text('\n'.join(logs), encoding='utf-8')
(qa / 'folder7z-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in result.items() if key != 'files'}, ensure_ascii=False, indent=2))
