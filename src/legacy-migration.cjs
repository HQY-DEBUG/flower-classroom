'use strict';

// Explicit, read-only legacy discovery. Construction and normal application
// startup never inspect AppData. Only a directory selected by the teacher is read.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const RECEIPT = 'legacy-migration-receipt-v1.json';
const JOURNAL = '.legacy-migration-journal-v1.json';
const LIMITS = Object.freeze({ files: 10000, bytes: 512 * 1024 * 1024, fileBytes: 100 * 1024 * 1024 });
const CORE = /^(?:classroom(?:-v2)?\.json(?:\.previous|\.damaged-[\w-]+)?|classroom-v2\.enabled|classroom-lock\.json)$/;
const METADATA = new Set(['avatar-location-v2.json', 'avatars-seeded-v1.txt', '头像-初始化-v2.txt',RECEIPT]);
const FOLDERS = new Set(['avatars', '头像', 'photos', 'materials', 'customrules']);
const CONFIG_INPUTS = {'配置.txt':'legacy-text','计分卡片.xlsx':'legacy-workbook','计分卡片.xlsx.flower-pending.json':'legacy-receipt','配置.xlsx':'configuration'};
const meaningful = name => CORE.test(name) || METADATA.has(name) || FOLDERS.has(name) || Object.hasOwn(CONFIG_INPUTS,name) || /^before-[^/\\]+\.json$/.test(name) || /^计分卡片(?:-[^/\\]+)?\.xlsx$/.test(name);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const inside = (root, value) => { const relative = path.relative(root, value); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const stamp = entries => hash(JSON.stringify(entries.map(({ relative, size, sha256 }) => ({ relative, size, sha256 }))));
const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);

function createLegacyMigration({ dataDirectory, backupDirectory, resourceDirectory, validate, allowPristineFiles = {}, disk = fs, io = fs.promises } = {}) {
  if (![dataDirectory, backupDirectory, resourceDirectory].every(value => typeof value === 'string' && path.isAbsolute(value)) || typeof validate !== 'function') throw Error('迁移目录或校验器无效');
  const roots = { data: path.resolve(dataDirectory), backup: path.resolve(backupDirectory), resource: path.resolve(resourceDirectory) };
  const journalFile = path.join(roots.backup, JOURNAL);
  const sessions = new Map();
  const exists = file => { try { disk.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  function regular(file, directory = false) {
    const stat = disk.lstatSync(file);
    if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('UNSUPPORTED_FILE', `迁移只接受普通${directory ? '文件夹' : '文件'}：${path.basename(file)}`);
    return stat;
  }
  function bytes(file, max = LIMITS.fileBytes) {
    if (regular(file).size > max) fail('TOO_LARGE', `迁移文件超过读取上限：${path.basename(file)}`);
    return disk.readFileSync(file);
  }
  function json(file, max, expected) {
    try {
      const value = bytes(file, expected ? LIMITS.fileBytes : max);
      // Validate the exact bytes we parse, even if a concurrent save is later
      // replaced by the original before the final inventory comparison.
      if (expected && (value.length !== expected.size || hash(value) !== expected.sha256)) fail('SOURCE_CHANGED', '旧版文件在预览时发生变化，请关闭旧版程序并重新预览');
      if (expected && value.length > max) fail('TOO_LARGE', `迁移文件超过读取上限：${path.basename(file)}`);
      return JSON.parse(value.toString('utf8'));
    } catch (error) {
      if (expected && error.code === 'ENOENT') fail('SOURCE_CHANGED', '旧版文件在预览时发生变化，请关闭旧版程序并重新预览');
      if (error.code) throw error;
      fail('INVALID_JSON', `无法读取旧版配置：${path.basename(file)}`);
    }
  }
  function inspect(file, relative) { const value = bytes(file); return { relative, size: value.length, sha256: hash(value) }; }
  function inventory(root, { selected = false } = {}) {
    regular(root, true);
    const result = []; let total = 0;
    function walk(directory, prefix = '') {
      for (const name of disk.readdirSync(directory).sort()) {
        if (!prefix && selected && !meaningful(name)) continue;
        const file = path.join(directory, name), relative = prefix ? path.join(prefix, name) : name;
        const stat = disk.lstatSync(file);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail('UNSUPPORTED_FILE', `旧数据包含无法复制的项目：${relative}`);
        if (stat.isDirectory()) { walk(file, relative); continue; }
        const item = inspect(file, relative); result.push(item); total += item.size;
        if (result.length > LIMITS.files || total > LIMITS.bytes) fail('TOO_LARGE', '旧数据超过迁移容量上限，请先保留原目录并整理备份');
      }
    }
    walk(root); return result;
  }
  function activeFiles() {
    if (!exists(roots.data)) return [];
    regular(roots.data, true);
    return disk.readdirSync(roots.data).filter(name => CORE.test(name) || name === RECEIPT).sort().map(name => inspect(path.join(roots.data, name), name));
  }
  function targetSnapshot(pristine) {
    const entries = activeFiles();
    if (entries.some(item => !/^[a-f0-9]{64}$/.test(pristine?.[item.relative] || '') || pristine[item.relative] !== item.sha256)) fail('DESTINATION_NOT_EMPTY', '当前数据目录已有课堂资料或课堂锁，不能覆盖。请改用空的程序文件夹迁移');
    return stamp(entries);
  }
  function sourceSnapshot(source, files) {
    const entries = new Map(files.map(item => [item.relative, item]));
    return {
      has: name => entries.has(name),
      json(name, max) {
        const expected = entries.get(name);
        if (!expected) fail('INVALID_JSON', `无法读取旧版配置：${name}`);
        return json(path.join(source, name), max, expected);
      },
    };
  }
  function sourceState(snapshot) {
    const upgraded = ['classroom-v2.json', 'classroom-v2.json.previous', 'classroom-v2.enabled'].some(name => snapshot.has(name));
    const primary = upgraded ? 'classroom-v2.json' : 'classroom.json';
    let selected = primary, state, warning = '';
    try { state = validate(snapshot.json(selected)); }
    catch (error) {
      if (error.code === 'SOURCE_CHANGED') throw error;
      selected += '.previous';
      try { state = validate(snapshot.json(selected)); warning = '旧版主存档未能读取，将使用同版本的上一次完整存档；原文件一并保留在迁移备份中'; }
      catch (error) {
        if (error.code === 'SOURCE_CHANGED') throw error;
        fail('INVALID_CLASSROOM', '没有找到可读取的完整旧版课堂存档。未改动原目录，请选择包含 classroom.json 或 classroom-v2.json 的文件夹');
      }
    }
    let lock = { configured: false, locked: false };
    if (snapshot.has('classroom-lock.json')) {
      const config = snapshot.json('classroom-lock.json', 4096);
      if (!isPlain(config) || Object.keys(config).sort().join(',') !== 'hash,locked,salt,version' || config.version !== 1 || typeof config.locked !== 'boolean' || !/^[a-f0-9]{64}$/.test(config.salt || '') || !/^[a-f0-9]{128}$/.test(config.hash || '')) fail('INVALID_LOCK', '旧版课堂锁配置无法读取。为保留课堂保护，本次迁移已停止，原文件未改动');
      lock = { configured: true, locked: config.locked };
    }
    return { state, primary, selected, lock, warning };
  }
  function resourceReferences(source, snapshot) {
    let index=null,avatarPath;
    if(snapshot.has('avatar-location-v2.json')){
      index=snapshot.json('avatar-location-v2.json',64*1024);
      const knownRelative=index?.directory==='头像'&&path.basename(source)==='数据';
      if (!isPlain(index) || index.version !== 2 || typeof index.directory !== 'string' || (!path.isAbsolute(index.directory) && !knownRelative) || !Array.isArray(index.seededFiles) || index.seededFiles.length > 1000 || index.seededFiles.some(name => typeof name !== 'string' || name !== path.basename(name) || !name)) fail('INVALID_AVATAR_INDEX', '旧版头像目录记录无效，未读取记录指向的文件夹。请保留旧目录并检查 avatar-location-v2.json');
      avatarPath=knownRelative?path.join(path.dirname(source),'头像'):path.resolve(index.directory);
    }
    // Folder-edition indexes have one fixed sibling resource location. It is
    // displayed for approval just like RC14's absolute external resource path.
    const root=path.basename(source)==='数据'?path.dirname(source):avatarPath?path.dirname(avatarPath):source;
    const candidates=avatarPath?[{kind:'avatars',path:avatarPath},{kind:'avatar-marker',path:path.join(path.dirname(avatarPath),'头像-初始化-v2.txt')}]:[];
    for(const [name,kind]of Object.entries(CONFIG_INPUTS))candidates.push({kind,path:path.join(root,name),optional:true});
    // A folder may be copied again before the teacher has confirmed its old
    // configuration. Carry that pending, already-local evidence forward too.
    if(snapshot.has(RECEIPT)){
      const receipt=snapshot.json(RECEIPT,64*1024),sources=receipt.configurationSources;
      if(sources!==undefined){
        if(!Array.isArray(sources)||sources.length>3)fail('INVALID_CONFIGURATION_RECEIPT','旧迁移配置来源记录无效，请保留原目录并核对');
        if(sources.length){
          const archive=typeof receipt.archiveRelativePath==='string'&&!path.isAbsolute(receipt.archiveRelativePath)?path.resolve(root,receipt.archiveRelativePath):typeof receipt.archiveDirectory==='string'?path.resolve(receipt.archiveDirectory):'';
          if(!archive||!inside(path.join(root,'备份'),archive)||archive===path.join(root,'备份'))fail('INVALID_CONFIGURATION_RECEIPT','旧迁移配置备份不在所选程序文件夹中，请保留并完整复制原文件夹');
          const kinds=new Set();
          for(const source of sources){
            if(!isPlain(source)||!['legacy-text','legacy-workbook','legacy-receipt'].includes(source.kind)||kinds.has(source.kind)||typeof source.relativePath!=='string'||path.isAbsolute(source.relativePath)||!/^[a-f0-9]{64}$/.test(source.sha256||'')||!Number.isSafeInteger(source.sizeBytes)||source.sizeBytes<0||source.sizeBytes>LIMITS.fileBytes)fail('INVALID_CONFIGURATION_RECEIPT','旧迁移配置来源记录无效，请保留原目录并核对');
            const target=path.resolve(archive,source.relativePath);
            if(!inside(archive,target)||target===archive)fail('INVALID_CONFIGURATION_RECEIPT','旧迁移配置来源位置无效，请保留原目录并核对');
            kinds.add(source.kind);candidates.push({kind:source.kind,path:target,expectedConfiguration:{sha256:source.sha256,sizeBytes:source.sizeBytes}});
          }
        }
      }
    }
    return {externalResources:candidates.filter(item=>!inside(source,item.path)),index:index?{...index,directory:avatarPath}:null};
  }
  function preview(sourceDirectory, options = {}) {
    if (typeof sourceDirectory !== 'string' || !path.isAbsolute(sourceDirectory)) fail('INVALID_SOURCE', '请通过文件夹选择窗口选择旧版数据目录');
    const source = path.resolve(sourceDirectory);
    if (inside(source, roots.data) || inside(roots.data, source) || inside(source, roots.backup) || inside(roots.backup, source)) fail('OVERLAPPING_DIRECTORIES', '旧版目录不能与当前数据或备份目录重叠');
    regular(source, true);
    const pristine = { ...(options.allowPristineFiles || allowPristineFiles) }, target = targetSnapshot(pristine);
    const files = inventory(source, { selected: true }), captured = sourceSnapshot(source, files);
    const loaded = sourceState(captured), resources = resourceReferences(source, captured);
    const states = [loaded.state, ...(loaded.state.panels?.others || []).map(panel => panel.data)];
    const token = randomUUID();
    const summary = { panels: states.length, students: states.reduce((n, state) => n + state.students.length, 0), photos: states.reduce((n, state) => n + state.students.filter(student => student.photo).length, 0), revision: loaded.state.revision, lock: loaded.lock, sourceFile: loaded.selected, replacesUnusedExample: activeFiles().length > 0 };
    const session = { token, source, pristine, target, pristineWorkbookHash: options.allowPristineWorkbookHash || null, sourceStamp: stamp(files), files, ...loaded, ...resources, summary, warnings: loaded.warning ? [loaded.warning] : [], status: 'preview', operations: [], externalInventories: [] };
    if (resources.index?.seededFiles.length) session.warnings.push('迁移会保留旧版头像初始化记录；原头像文件夹不可用时，也不会补回已记录的默认头像。已有自定义图片会保留');
    else if (files.some(item => item.relative === 'avatars-seeded-v1.txt' || item.relative === '头像-初始化-v2.txt') && !exists(path.join(source, 'avatars')) && !exists(path.join(source, '头像'))) session.warnings.push('旧版头像文件夹已缺失，将保留初始化记录，不补回旧版已记录的默认头像；已有自定义图片会保留');
    if (stamp(inventory(source, { selected: true })) !== session.sourceStamp) fail('SOURCE_CHANGED', '旧版文件在预览时发生变化，请关闭旧版程序并重新预览');
    // Preview records contain no source writes and no application state changes.
    sessions.set(token, session);
    for (const [key, value] of sessions) if (sessions.size > 12 && value.status === 'preview' && key !== token) sessions.delete(key);
    return { token, sourceDirectory: source, dataDirectory: roots.data, backupDirectory: roots.backup, summary, externalResources: resources.externalResources, files: files.map(item => ({ path: item.relative, bytes: item.size })), bytes: files.reduce((n, item) => n + item.size, 0), warnings: [...session.warnings] };
  }
  function get(token) { const session = sessions.get(token); if (!session) fail('EXPIRED_PREVIEW', '迁移预览已过期，请重新选择旧版文件夹'); return session; }
  function ensureCurrent(session, check = () => {}) {
    check();
    if (targetSnapshot(session.pristine) !== session.target) fail('TARGET_CHANGED', '当前课堂资料已变化，请重新预览迁移');
    if (stamp(inventory(session.source, { selected: true })) !== session.sourceStamp) fail('SOURCE_CHANGED', '旧版文件在预览后发生变化，请关闭旧版程序并重新预览');
    for (const item of session.externalInventories) {
      if (item.missing) { if (exists(item.path)) fail('SOURCE_CHANGED', '旧版资源在预览后发生变化，请重新预览迁移'); continue; }
      const current = item.directory ? inventory(item.path) : [inspect(item.path, path.basename(item.path))];
      if (stamp(current) !== item.stamp) fail('SOURCE_CHANGED', '旧版资源在复制后发生变化，请重新预览迁移');
    }
    check();
  }
  async function copyFiles(source, destination, files, session) {
    for (const item of files) {
      if (session.cancelled) fail('CANCELLED', '已取消迁移，旧版数据未改动');
      const output = path.join(destination, item.relative);
      await io.mkdir(path.dirname(output), { recursive: true });
      await io.copyFile(path.join(source, item.relative), output, fs.constants.COPYFILE_EXCL);
      if (hash(await io.readFile(output)) !== item.sha256) fail('COPY_FAILED', '迁移副本校验失败，旧版数据未改动');
      const handle = await io.open(output, 'r');
      try { await handle.sync(); } finally { await handle.close(); }
    }
  }
  const targetFor = operation => path.join(roots[operation.scope], operation.relative);
  function addOperation(session, scope, relative, staged, expected = null) {
    const destination = path.join(roots[scope], relative);
    if (!inside(roots[scope], destination) || destination === roots[scope]) fail('INVALID_DESTINATION', '迁移目标无效');
    if (session.operations.some(item => targetFor(item) === destination)) return;
    session.operations.push({ scope, relative, staged: path.relative(session.stage, staged), previous: `previous/${session.operations.length}`, expected });
  }
  function addResource(session, relative, staged) {
    let destination = path.join(roots.resource, relative);
    if (exists(destination)) {
      const existing = bytes(destination), incoming = bytes(staged);
      if (hash(existing) === hash(incoming)) return;
      // Only the exact generated, never-edited template can be replaced.
      if (relative === '配置.xlsx' && (require('./score-rule-workbook.cjs').isInitialBytes(existing) || hash(existing) === session.pristineWorkbookHash)) {
        addOperation(session, 'resource', relative, staged, hash(existing));
        return;
      }
      if(relative==='配置.xlsx')fail('CONFIGURATION_DESTINATION_CHANGED','目标配置.xlsx已被修改，不能用迁入配置覆盖。原文件未改动，请把新版完整解压到全新目录后迁移');
      if (path.dirname(relative) === '头像' && require('../assets/avatar-defaults/manifest.json').files.some(item => item.fileName === path.basename(relative))) {
        const bundled = bytes(path.join(__dirname, '../assets/avatar-defaults', path.basename(relative)));
        if (hash(existing) === hash(bundled)) {
          // Preserve filename-based roster imports when an old default was
          // customized. An edited destination never enters this branch.
          addOperation(session, 'resource', relative, staged, hash(existing));
          return;
        }
      }
      const extension = path.extname(relative), name = path.basename(relative, extension);
      relative = path.join(path.dirname(relative), `${name}-迁入-${hash(bytes(staged)).slice(0, 12)}${extension}`);
      destination = path.join(roots.resource, relative);
      if (exists(destination)) {
        if (hash(bytes(destination)) === hash(bytes(staged))) return;
        fail('RESOURCE_CONFLICT', '迁入资源重名且内容不同，请先保留文件并重新选择空的程序目录');
      }
      session.warnings.push(`当前同名资源已保留，旧版文件另存为：${relative}`);
    }
    addOperation(session, 'resource', relative, staged);
  }
  async function prepare(token, options = {}) {
    const session = get(token);
    if (session.status === 'prepared' || session.status === 'committed') return session.result || { token, prepared: true, warnings: [...session.warnings] };
    if (session.status !== 'preview') fail('MIGRATION_BUSY', '迁移正在准备，请稍候');
    const approved = new Set(options.approvedResourcePaths || []);
    if (session.externalResources.some(item => !approved.has(item.path))) fail('RESOURCE_APPROVAL_REQUIRED', '请先确认预览中列出的旧版资源路径，再复制资源');
    session.status = 'preparing'; session.cancelled = false; session.operations = []; session.externalInventories = [];
    session.stage = path.join(roots.backup, `.legacy-migration-${session.token}`);
    try {
      ensureCurrent(session, options.check);
      await io.mkdir(roots.backup, { recursive: true });
      await io.mkdir(session.stage, { recursive: false, mode: 0o700 });
      const archive = path.join(session.stage, 'archive');
      await io.mkdir(archive);
      const archivedSource = path.join(archive, '旧版数据');
      await copyFiles(session.source, archivedSource, session.files, session);
      const resourceSources = [];
      for (let index = 0; index < session.externalResources.length; index++) {
        const item = session.externalResources[index];
        if (!exists(item.path)) { if(item.expectedConfiguration)fail('SOURCE_CHANGED','待迁入的旧配置备份已缺失，请保留并完整复制原程序文件夹后重试');session.externalInventories.push({ path: item.path, missing: true }); if(!item.optional)session.warnings.push(`旧版资源未找到，已保留其目录记录：${item.path}`); continue; }
        if (inside(item.path, roots.data) || inside(item.path, roots.backup) || inside(roots.data, item.path) || inside(roots.backup, item.path)) fail('OVERLAPPING_DIRECTORIES', '旧版资源不能指向当前数据或备份目录');
        const directory = item.kind === 'avatars';
        const files = directory ? inventory(item.path) : [inspect(item.path, path.basename(item.path))];
        if(item.expectedConfiguration&&(files[0].sha256!==item.expectedConfiguration.sha256||files[0].size!==item.expectedConfiguration.sizeBytes))fail('SOURCE_CHANGED','待迁入的旧配置备份已改变，请保留原件并重新核对后迁移');
        const previousBytes = session.files.reduce((n, file) => n + file.size, 0) + resourceSources.reduce((n, source) => n + source.files.reduce((total, file) => total + file.size, 0), 0);
        if (previousBytes + files.reduce((n, file) => n + file.size, 0) > LIMITS.bytes) fail('TOO_LARGE', '旧数据和关联资源超过迁移容量上限，请保留原目录并整理备份');
        session.externalInventories.push({ path: item.path, directory, stamp: stamp(files) });
        const folder = path.join(archive, `关联资源-${index + 1}`);
        await copyFiles(directory ? item.path : path.dirname(item.path), folder, files, session);
        resourceSources.push({ ...item, directory: folder, files });
      }
      const active = path.join(session.stage, 'active'); await io.mkdir(active);
      for (const item of session.files.filter(item => !item.relative.includes(path.sep) && CORE.test(item.relative))) {
        // Recovery normalizes the active primary only; the exact original remains archived.
        const sourceName = item.relative === session.primary ? session.selected : item.relative;
        const staged = path.join(active, item.relative);
        await io.copyFile(path.join(archivedSource, sourceName), staged, fs.constants.COPYFILE_EXCL);
        addOperation(session, 'data', item.relative, staged, session.pristine[item.relative] || null);
      }
      if (!session.operations.some(item => item.scope === 'data' && item.relative === session.primary)) {
        const staged = path.join(active, session.primary); await io.copyFile(path.join(archivedSource, session.selected), staged, fs.constants.COPYFILE_EXCL);
        addOperation(session, 'data', session.primary, staged, session.pristine[session.primary] || null);
      }
      // An unused v2 example must not hide an imported v1 classroom at restart.
      for (const name of Object.keys(session.pristine)) if (CORE.test(name) && exists(path.join(roots.data, name)) && !session.operations.some(item => item.scope === 'data' && item.relative === name)) addOperation(session, 'data', name, path.join(session.stage, 'delete', name), session.pristine[name]);
      const localAvatarFolder = session.index ? (inside(session.source, path.resolve(session.index.directory)) ? path.relative(session.source, path.resolve(session.index.directory)) : null) : (exists(path.join(session.source, '头像')) ? '头像' : 'avatars');
      for (const item of session.files) {
        const parts = item.relative.split(path.sep), top = parts[0];
        if (top === localAvatarFolder && parts.length === 2 && /\.(png|jpe?g|webp)$/i.test(parts[1])) addResource(session, path.join('头像', parts[1]), path.join(archivedSource, item.relative));
        else if ((['photos', 'materials', 'customrules'].includes(top) && /\.(png|jpe?g|webp|xlsx|json|txt|csv|pdf|md)$/i.test(item.relative)) || /^计分卡片-[^/\\]+\.xlsx$/.test(item.relative)) addResource(session, item.relative, path.join(archivedSource, item.relative));
      }
      for (const item of resourceSources) {
        if (item.kind === 'avatars') for (const file of item.files) if (!file.relative.includes(path.sep) && /\.(png|jpe?g|webp)$/i.test(file.relative)) addResource(session, path.join('头像', file.relative), path.join(item.directory, file.relative));
      }
      // Original legacy parameters are archived byte-for-byte. They are not
      // applied during classroom copy and never become active separate files.
      // The unified-workbook preview consumes only these local archived copies.
      session.configurationSources=[];let copiedUnified=false;
      for(const [name,kind]of Object.entries(CONFIG_INPUTS)){
        const matches=resourceSources.filter(item=>item.kind===kind);
        if(new Set(matches.map(item=>item.files[0].sha256)).size>1)fail('SOURCE_CONFIGURATION_CONFLICT','旧程序目录与待迁入备份中的配置不一致，请先在旧程序核对并完成配置确认，再迁移；原件未改动');
        const external=matches[0];
        const copied=external?path.join(external.directory,external.files[0].relative):session.files.some(item=>item.relative===name)?path.join(archivedSource,name):null;
        if(!copied)continue;
        const captured=bytes(copied);
        if(kind==='configuration'){addResource(session,'配置.xlsx',copied);copiedUnified=true;continue;}
        if(kind!=='configuration')session.configurationSources.push({kind,relativePath:path.relative(archive,copied),sha256:hash(captured),sizeBytes:captured.length});
      }
      if(session.configurationSources.length)session.warnings.push('旧配置原件已复制到迁移备份；重启后请在统一配置表中预览并确认迁入设置。当前课堂记录不会在复制时被配置文件改写');
      const sharingPending=require('./score-rules.js').previewShared(session.state).required;
      if(!copiedUnified&&(session.configurationSources.length||sharingPending)){
        const initial=path.join(active,'pending-unified-configuration.xlsx');
        await io.writeFile(initial,await require('./score-rule-workbook.cjs').buildInitialBytes(),{flag:'wx'});
        addResource(session,'配置.xlsx',initial);
      }else if(!copiedUnified){
        const generated=path.join(active,'migrated-configuration.xlsx');
        await io.writeFile(generated,await require('./score-rule-workbook.cjs').buildBytes(session.state),{flag:'wx'});
        addResource(session,'配置.xlsx',generated);
      }
      // Prior deletion records apply only to untouched bundled destinations.
      // A teacher's replacement of the same name is always retained.
      const associatedAvatars = resourceSources.find(item => item.kind === 'avatars');
      let sourceAvatarFiles = associatedAvatars?.files || (localAvatarFolder && exists(path.join(session.source, localAvatarFolder)) ? session.files.filter(item => path.dirname(item.relative) === localAvatarFolder).map(item => ({ ...item, relative: path.basename(item.relative) })) : null);
      const oldPetNames = Object.entries(require('./pet-art.js').names).map(([, name], index) => `${String(index + 1).padStart(2, '0')}-${name}.png`);
      let seededFiles = session.index?.seededFiles || (session.files.some(item => item.relative === 'avatars-seeded-v1.txt') ? oldPetNames : []);
      if (!session.index && session.files.some(item => item.relative === '头像-初始化-v2.txt')) {
        try { const marker = JSON.parse(bytes(path.join(archivedSource, '头像-初始化-v2.txt'), 64 * 1024).toString().split('\n')[0]); if (Array.isArray(marker.seededFiles)) seededFiles = marker.seededFiles; } catch {}
      }
      if (!sourceAvatarFiles && seededFiles.length) {
        // Missing folders must not resurrect previously seeded defaults. This
        // also preserves that history when an external drive is unavailable;
        // only unchanged bundled destinations are suppressed, never custom files.
        sourceAvatarFiles = [];
        session.warnings.push('旧版头像文件夹不可用，已保留初始化记录并避免补回已记录的默认头像；自定义图片仍需从原目录找回');
      }
      if (sourceAvatarFiles) {
        const names = new Set(sourceAvatarFiles.map(item => item.relative));
        const defaults = new Set(require('../assets/avatar-defaults/manifest.json').files.map(item => item.fileName));
        for (const name of seededFiles) {
          if (!defaults.has(name) || names.has(name)) continue;
          const target = path.join(roots.resource, '头像', name), bundled = path.join(__dirname, '../assets/avatar-defaults', name);
          if (exists(target) && hash(bytes(target)) === hash(bytes(bundled))) addOperation(session, 'resource', path.join('头像', name), path.join(session.stage, 'delete-avatar', name), hash(bytes(target)));
        }
      }
      // Keep an explicit seed record so deleted legacy defaults are not reintroduced.
      if (!exists(path.join(roots.resource, '头像-初始化-v2.txt'))) {
        const oldMarker = session.files.find(item => item.relative === '头像-初始化-v2.txt');
        const associatedMarker = resourceSources.find(item => item.kind === 'avatar-marker');
        const staged = path.join(active, '头像-初始化-v2.txt');
        if (oldMarker || associatedMarker) await io.copyFile(oldMarker ? path.join(archivedSource, oldMarker.relative) : path.join(associatedMarker.directory, associatedMarker.files[0].relative), staged);
        else {
          await io.writeFile(staged, JSON.stringify({ version: 2, seededFiles }) + '\nflower-avatar-library-v1:complete\n', { flag: 'wx' });
        }
        addOperation(session, 'resource', '头像-初始化-v2.txt', staged);
      }
      // Operations cannot consume archive files: each active resource gets its own copy.
      for (let index = 0; index < session.operations.length; index++) {
        const operation = session.operations[index], staged = path.join(session.stage, operation.staged);
        if (inside(archive, staged)) { const copy = path.join(active, `resource-${index}`); await io.copyFile(staged, copy, fs.constants.COPYFILE_EXCL); operation.staged = path.relative(session.stage, copy); }
        operation.remove = !exists(path.join(session.stage, operation.staged));
      }
      const archiveName = `旧版迁移-${new Date().toISOString().replace(/[:.]/g, '-')}-${token}`;
      await io.writeFile(path.join(archive, '迁移说明.json'), JSON.stringify({ version: 1, sourceDirectory: session.source, files: session.files, externalResources: session.externalResources, summary: session.summary, warnings: session.warnings }, null, 2), { flag: 'wx' });
      session.archiveName = archiveName;
      addOperation(session, 'backup', archiveName, archive);
      ensureCurrent(session, options.check);
      if (session.cancelled) fail('CANCELLED', '已取消迁移，旧版数据未改动');
      session.status = 'prepared';
      return { token, prepared: true, warnings: [...session.warnings], archiveDirectory: path.join(roots.backup, archiveName), summary: session.summary };
    } catch (error) {
      await io.rm(session.stage, { recursive: true, force: true }).catch(() => {});
      session.status = session.cancelled ? 'cancelled' : 'preview';
      throw error;
    }
  }
  function writeDurable(file, value) {
    // A failed open does not confer ownership of an existing file. Once this
    // attempt creates it, a partial write/fsync/close failure can remove only
    // that incomplete file; prepared copies and earlier attempts stay intact.
    const fd = disk.openSync(file, 'wx', 0o600);
    try {
      try { disk.writeFileSync(fd, JSON.stringify(value) + '\n'); disk.fsyncSync(fd); }
      finally { disk.closeSync(fd); }
    } catch (error) {
      try { disk.rmSync(file, { force: true }); } catch {}
      throw error;
    }
  }
  function rollback(record) {
    for (const operation of [...record.operations].reverse()) {
      const target = targetFor(operation), staged = path.join(record.stage, operation.staged), previous = path.join(record.stage, operation.previous);
      if (exists(previous)) {
        if (exists(target)) { disk.mkdirSync(path.dirname(staged), { recursive: true }); disk.renameSync(target, staged); }
        disk.renameSync(previous, target);
      } else if (!operation.expected && !operation.remove && !exists(staged) && exists(target)) {
        disk.mkdirSync(path.dirname(staged), { recursive: true }); disk.renameSync(target, staged);
      }
    }
  }
  function commit(token, options = {}) {
    const session = get(token);
    if (session.status === 'committed') return session.result;
    if (session.status !== 'prepared') fail('NOT_PREPARED', '请先确认并准备迁移副本');
    ensureCurrent(session, options.check);
    if (exists(journalFile)) fail('RECOVERY_REQUIRED', '上一次迁移尚待恢复，请重启程序后再继续');
    for (const operation of session.operations) {
      const target = targetFor(operation);
      if (operation.expected ? !exists(target) || hash(bytes(target)) !== operation.expected : exists(target)) fail('TARGET_CHANGED', '当前资源在迁移准备后发生变化，请重新预览，已有文件未覆盖');
    }
    const receipt = { version: 1, token, sourceDirectory: session.source, sourceFingerprint: session.sourceStamp, migratedAt: new Date().toISOString(), archiveDirectory: path.join(roots.backup, session.archiveName), archiveRelativePath:path.relative(roots.resource,path.join(roots.backup,session.archiveName)), summary: session.summary, warnings: [...session.warnings],configurationSources:session.configurationSources||[] };
    const stagedReceipt = path.join(session.stage, 'receipt.json'); writeDurable(stagedReceipt, receipt);
    addOperation(session, 'data', RECEIPT, stagedReceipt);
    const record = { version: 2, token, stage: path.basename(session.stage), operations: session.operations };
    const stagedJournal = path.join(session.stage, `journal-${randomUUID()}.pending`);
    let journalCreated = false;
    try {
      // Directory setup is also pre-publication work: a failed mkdir must
      // release this attempt's receipt so the same confirmation can retry.
      disk.mkdirSync(roots.data, { recursive: true }); disk.mkdirSync(path.join(session.stage, 'previous'), { recursive: true });
      // Only a complete, synced record is ever visible at the recovery path.
      // Both paths are on the backup volume, so publication is one rename.
      writeDurable(stagedJournal, record); journalCreated = true;
      if (exists(journalFile)) fail('RECOVERY_REQUIRED', '上一次迁移尚待恢复，请重启程序后再继续');
      disk.renameSync(stagedJournal, journalFile);
    } catch (error) {
      if (journalCreated) try { disk.rmSync(stagedJournal, { force: true }); } catch {}
      try { disk.rmSync(stagedReceipt, { force: true }); } catch {}
      session.operations = session.operations.filter(item => !(item.scope === 'data' && item.relative === RECEIPT));
      throw error;
    }
    try {
      // No awaits occur after the final caller guard. Main holds its mutation
      // gate through relaunch, so no window can observe an intermediate class.
      options.check?.();
      for (const operation of session.operations) {
        const target = targetFor(operation), staged = path.join(session.stage, operation.staged), previous = path.join(session.stage, operation.previous);
        disk.mkdirSync(path.dirname(target), { recursive: true });
        if (operation.expected) disk.renameSync(target, previous);
        if (!operation.remove) disk.renameSync(staged, target);
      }
      session.status = 'committed'; session.result = { ...receipt, state: session.state, restartRequired: true };
    } catch (error) {
      try { rollback(session); disk.unlinkSync(journalFile); disk.rmSync(stagedReceipt, { force: true }); session.operations = session.operations.filter(item => item.relative !== RECEIPT); }
      catch { session.status = 'recovery-required'; fail('RECOVERY_REQUIRED', '迁移未完成且回滚尚待恢复。旧目录未改动，请重启程序；请勿删除数据和备份目录'); }
      throw error;
    }
    // A committed receipt is the restart recovery decision. Cleanup failures
    // leave only an inert journal/staging folder and never undo committed data.
    try { disk.rmSync(session.stage, { recursive: true, force: true }); disk.unlinkSync(journalFile); } catch {}
    return session.result;
  }
  async function cancel(token) {
    const session = sessions.get(token); if (!session || session.status === 'cancelled') return { cancelled: true };
    if (session.status === 'committed') return { cancelled: false, committed: true };
    if (session.status === 'recovery-required') fail('RECOVERY_REQUIRED', '请重启以恢复未完成迁移');
    session.cancelled = true;
    if (session.status !== 'preparing') { if (session.stage) await io.rm(session.stage, { recursive: true, force: true }); session.status = 'cancelled'; }
    return { cancelled: true };
  }
  function recover() {
    if (!exists(journalFile)) return { recovered: false };
    let record;
    try { record = json(journalFile, 4 * 1024 * 1024); }
    catch (error) {
      // RC15 could leave a truncated final journal. Its surviving prefix does
      // not prove how far migration got; preserve all evidence for recovery.
      if (error.code === 'INVALID_JSON') fail('RECOVERY_REQUIRED', '迁移恢复记录不完整，请保留数据和备份目录，勿删除或覆盖其中的文件。如原旧版目录仍完整，可在新的空程序文件夹中重新选择它迁移');
      throw error;
    }
    if (!isPlain(record) || ![1, 2].includes(record.version) || typeof record.token !== 'string' || !/^[a-f0-9-]{36}$/.test(record.token) || !Array.isArray(record.operations) || record.operations.length > LIMITS.files + 20) fail('RECOVERY_REQUIRED', '迁移恢复记录无法读取，请保留数据和备份目录');
    const stageName = `.legacy-migration-${record.token}`;
    const validStage = record.version === 2 ? record.stage === stageName :
      typeof record.stage === 'string' && path.isAbsolute(record.stage) && path.basename(record.stage) === stageName;
    if (!validStage) fail('RECOVERY_REQUIRED', '迁移恢复目录记录无效，请保留数据和备份目录');
    // RC15's absolute path is accepted only as a token identity. Never follow
    // it, even when the old program folder still exists after a complete copy.
    record = { ...record, stage: path.join(roots.backup, stageName) };
    for (const operation of record.operations) if (!roots[operation.scope] || typeof operation.relative !== 'string' || !inside(roots[operation.scope], targetFor(operation)) || typeof operation.staged !== 'string' || !inside(record.stage, path.join(record.stage, operation.staged)) || typeof operation.previous !== 'string' || !inside(record.stage, path.join(record.stage, operation.previous))) fail('RECOVERY_REQUIRED', '迁移恢复路径无效，请保留数据和备份目录');
    let committed = false;
    const receipt = path.join(roots.data, RECEIPT);
    if (exists(receipt)) committed = json(receipt, 1024 * 1024).token === record.token;
    if (exists(record.stage)) regular(record.stage, true);
    else if (!committed) fail('RECOVERY_REQUIRED', '当前备份目录缺少迁移副本，请保留整个程序文件夹，勿删除或覆盖数据');
    if (!committed) rollback(record);
    disk.rmSync(record.stage, { recursive: true, force: true }); disk.unlinkSync(journalFile);
    return { recovered: true, committed };
  }
  return Object.freeze({ preview, prepare, commit, cancel, recover });
}

module.exports = { createLegacyMigration, RECEIPT, JOURNAL, LIMITS };
