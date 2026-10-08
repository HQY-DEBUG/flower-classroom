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
parser.add_argument('--dist-dir', default='dist-rc19-final')
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
qa = repo / 'artifacts/rc19/package'
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
    script = "(async()=>{const x=require('./scripts/prepare-folder-resources.cjs').verifyFolderResources(process.argv[1]);const W=require('./src/score-rule-workbook.cjs');await W.parseBytes(require('fs').readFileSync(require('path').join(process.argv[1],W.FILE_NAME)),require('./src/core.cjs').createInitialState(),undefined,{allowInitialTemplate:true});x.configurationParserValidated=true;console.log(JSON.stringify(x));})().catch(e=>{console.error(e);process.exit(1)})"
    checked = subprocess.run(['node', '-e', script, str(root)], cwd=repo, check=True, capture_output=True, text=True)
    return json.loads(checked.stdout)


source_files, source_dirs = inventory(source)
assert not any(name.lower().endswith('.md') for name in source_files), 'Loose Markdown files must not be distributed'
assert all(name in source_files for name in ['花伴课堂.exe', 'resources/app.asar', '配置.xlsx'])
assert '配置.txt' not in source_files and '计分卡片.xlsx' not in source_files
assert (source / '花伴课堂.exe').read_bytes()[:2] == b'MZ', 'Expected real Windows runtime executable'
source_resources = verify_resources(source)
# Build from a separate verified copy so active acceptance runs keep a stable
# canonical ASAR path. The recovered executor has room for full fresh extraction.
logs = []
def seven_zip(*arguments, cwd=None):
    command = [str(Path(args.seven_zip).resolve()), *map(str, arguments)]
    completed = subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)
    logs.append('$ ' + ' '.join(command) + '\n' + completed.stdout + completed.stderr)
    return completed.stdout
assert not target.exists(), 'Preserve existing archive; select a new output destination'
with tempfile.TemporaryDirectory(prefix='flower-rc19-folder-production-') as temporary:
    temporary = Path(temporary)
    staging = temporary / 'staging'
    staging.mkdir()
    shutil.copytree(source, staging / top_folder)
    assert inventory(staging / top_folder) == (source_files, source_dirs)
    seven_zip('a', '-t7z', '-m0=lzma2', '-mx=9', '-md=128m', '-mfb=273', '-ms=on', '-mmt=2', target, top_folder, cwd=staging)
    assert target.read_bytes()[:6] == b"7z\xbc\xaf'\x1c", 'Expected genuine 7z'
    assert target.stat().st_size < 100 * 1024 * 1024
    seven_zip('t', target)
    seven_zip('l', '-slt', target)
    extracted = temporary / 'fresh-extraction'
    seven_zip('x', '-y', f'-o{extracted}', target)
    assert [file.name for file in extracted.iterdir()] == [top_folder]
    payload = extracted / top_folder
    payload_files, payload_dirs = inventory(payload)
    assert payload_files == source_files, 'Fresh extraction bytes/names mismatch'
    assert payload_dirs == source_dirs, 'Fresh extraction lost directories'
    resources = verify_resources(payload)
    assert resources['avatarCount'] == 120
    assert inventory(source) == (source_files, source_dirs), 'Canonical runtime changed during archive verification'

result = {
    'version': version, 'status': 'passed', 'verifiedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'file': str(target), 'sizeBytes': target.stat().st_size, 'sha256': sha(target),
    'true7z': True, 'format': '7z', 'compression': 'LZMA2', 'dictionaryMiB': 128, 'compressionLevel': 9,
    'topLevelFolder': top_folder, 'crcPassed': True, 'under100MiB': True,
    'source': str(source), 'standardZip': None, 'standardZipSha256': None, 'standardZipNotBuilt': True,
    'unpackedFilesExactlyMatched': len(source_files), 'freshlyExtractedFilesExactlyMatched': len(payload_files),
    'directoriesExactlyMatched': sorted(source_dirs), 'emptyDirectoriesPreserved': ['数据', '备份'],
    'avatarCount': 120, 'allAvatarOriginalHashesMatched': True, 'configParserValidated': True,
    'initialWorkbookSha256': source_resources['workbookSha256'],
    'asarSha256': source_files['resources/app.asar']['sha256'],
    'runtimeExeSha256': source_files['花伴课堂.exe']['sha256'],
    'looseMarkdownCount': 0, 'files': source_files, 'windowsExecuted': False,
    'notes': 'Folder-only archive built from a verified copy. All bytes and empty directories matched fresh extraction. Canonical acceptance runtime was unchanged. No single-file portable wrapper or standard ZIP was built.'
}
(qa / 'folder7z-integrity.txt').write_text('\n'.join(logs), encoding='utf-8')
(qa / 'folder7z-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in result.items() if key != 'files'}, ensure_ascii=False, indent=2))
