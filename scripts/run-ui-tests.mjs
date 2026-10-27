import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {build} from 'esbuild'

// UI tests: React components in jsdom, bundled per test file with esbuild and run by node:test (same tooling as the domain tests).
const root=process.cwd()
const dir=path.join(root,'tests','ui')
const out=path.join(root,'.test-dist','ui')
fs.rmSync(out,{recursive:true,force:true})
fs.mkdirSync(out,{recursive:true})

const files=fs.readdirSync(dir).filter(f=>f.endsWith('.test.tsx'))
for(const file of files){
  await build({
    entryPoints:[path.join(dir,file)],outfile:path.join(out,file.replace(/\.tsx$/,'.mjs')),
    bundle:true,format:'esm',platform:'node',target:'node18',jsx:'automatic',logLevel:'warning',
    external:['jsdom'],loader:{'.css':'empty'},
    define:{'process.env.NODE_ENV':'"development"'},
    // Bundled CommonJS (react) inside an ES module needs require.
    banner:{js:"import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);"},
  })
}
const result=spawnSync(process.execPath,['--test',...files.map(f=>path.join(out,f.replace(/\.tsx$/,'.mjs')))],{stdio:'inherit',cwd:root})
process.exit(result.status??1)
