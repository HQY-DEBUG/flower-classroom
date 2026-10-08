// Cross-platform PE resource customization. No Wine or signing key required.
const fs=require('node:fs');const path=require('node:path');
const PELibrary=require('pe-library');const ResEdit=require('resedit');
async function customize(context){
 if(context.electronPlatformName!=='win32')return;
 const file=path.join(context.appOutDir,'花伴课堂.exe');
 const executable=PELibrary.NtExecutable.from(fs.readFileSync(file));
 const resource=PELibrary.NtExecutableResource.from(executable);
 const icon=ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname,'../assets/icon.ico')));
 const groups=ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);
 for(const group of groups)ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries,group.id,group.lang,icon.icons.map(item=>item.data));
 for(const version of ResEdit.Resource.VersionInfo.fromEntries(resource.entries)){
  const [major,minor,patch]=require('../package.json').version.split('-')[0].split('.').map(Number);version.setFileVersion(major,minor,patch,0,1033);version.setProductVersion(major,minor,patch,0,1033);
  version.setStringValues({lang:1033,codepage:1200},{CompanyName:'Flower Classroom',FileDescription:'花伴课堂',ProductName:'花伴课堂',InternalName:'FlowerClassroom',OriginalFilename:'花伴课堂.exe',LegalCopyright:'Copyright © 2026 Flower Classroom'});
  version.outputToResourceEntries(resource.entries);
 }
 resource.outputResource(executable);
 fs.writeFileSync(file,Buffer.from(executable.generate()));
 // Verify the resulting executable is parseable and retains its ASAR integrity resource.
 const verified=PELibrary.NtExecutableResource.from(PELibrary.NtExecutable.from(fs.readFileSync(file)));
 if(!verified.entries.some(e=>e.type==='INTEGRITY'))throw new Error('ASAR integrity resource not preserved');
 console.log('Windows icon and version resources verified');
 await require('./prepare-folder-resources.cjs').prepareFolderResources(context);
}
module.exports=customize;
