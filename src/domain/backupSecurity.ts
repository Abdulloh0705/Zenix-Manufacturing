import type {ManufacturingState} from '../types'

/** Normal business backups may restore operations, but never company access state. */
export function backupSecurityBlocker(current:ManufacturingState,incoming:ManufacturingState):string|null{
  if(incoming.roles.some(r=>!r||typeof r.id!=='string'||typeof r.key!=='string'&&r.key!==undefined)||incoming.employees.some(e=>!e||typeof e.id!=='string'||typeof e.roleId!=='string'))return 'Backup xavfsizlik yozuvlari noto‘g‘ri'
  const currentRoles=new Map(current.roles.map(role=>[role.id,role]))
  if(incoming.roles.length!==current.roles.length)return 'Backup rollar tarkibini o‘zgartiradi'
  for(const role of incoming.roles){
    const before=currentRoles.get(role.id)
    if(!before||JSON.stringify(role)!==JSON.stringify(before))return 'Backup rol yoki ruxsatlarni o‘zgartiradi'
  }
  const currentEmployees=new Map(current.employees.map(employee=>[employee.id,employee]))
  if(incoming.employees.length!==current.employees.length)return 'Backup xodim identifikatorlarini o‘zgartiradi'
  for(const employee of incoming.employees){
    const before=currentEmployees.get(employee.id)
    if(!before||employee.roleId!==before.roleId||employee.status!==before.status||employee.workCenterId!==before.workCenterId||employee.warehouseId!==before.warehouseId)
      return 'Backup xodim roli, holati yoki joy doirasini o‘zgartiradi'
  }
  return null
}

/** Explicit owner recovery can restore custom roles and employee assignments, never protected identities. */
export function privilegedBackupBlocker(current:ManufacturingState,incoming:ManufacturingState,actorEmployeeId:string,accountEmployeeIds:string[]):string|null{
  if(incoming.roles.some(r=>!r||typeof r.id!=='string'||!r.permissions||typeof r.permissions!=='object')||incoming.employees.some(e=>!e||typeof e.id!=='string'||typeof e.roleId!=='string'))return 'Backup xavfsizlik yozuvlari noto‘g‘ri'
  const roleIds=new Set(incoming.roles.map(r=>r.id)),employeeIds=new Set(incoming.employees.map(e=>e.id))
  if(roleIds.size!==incoming.roles.length||employeeIds.size!==incoming.employees.length)return 'Backupda takroriy rol yoki xodim ID bor'
  for(const protectedRole of current.roles.filter(r=>r.system||r.key)){
    const restored=incoming.roles.find(r=>r.id===protectedRole.id)
    if(!restored||JSON.stringify(restored)!==JSON.stringify(protectedRole))return 'Backup tizim roli yoki biznes egasi huquqlarini o‘zgartiradi'
  }
  const protectedIds=new Set(current.roles.filter(r=>r.system||r.key).map(r=>r.id))
  for(const role of incoming.roles){
    if(!protectedIds.has(role.id)&&(role.key||role.system))return 'Backup imtiyozli rol kalitini qo‘shadi'
    if(!['all','branch','warehouse','workcenter'].includes(role.scope))return 'Backupda rol doirasi noto‘g‘ri'
    if(!protectedIds.has(role.id)){
      if(role.rank!==undefined&&(!Number.isInteger(role.rank)||role.rank<1||role.rank>3))return 'Backupda maxsus rol darajasi noto‘g‘ri'
      if(role.permissions.platform||role.permissions.subscription?.edit)return 'Backup maxsus rolga platforma yoki obuna huquqini qo‘shadi'
    }
  }
  for(const employee of incoming.employees){
    if(!roleIds.has(employee.roleId))return 'Backupda xodim roli topilmadi'
    if(employee.workCenterId&&!incoming.workCenters.some(w=>w.id===employee.workCenterId))return 'Backupda xodim ish markazi topilmadi'
    if(employee.warehouseId&&!incoming.warehouses.some(w=>w.id===employee.warehouseId))return 'Backupda xodim ombori topilmadi'
  }
  if(accountEmployeeIds.some(id=>!employeeIds.has(id)))return 'Backup mavjud akkauntga bog‘langan xodimni yo‘qotadi'
  const actor=incoming.employees.find(e=>e.id===actorEmployeeId)
  if(!actor||actor.status==='Arxiv'||incoming.roles.find(r=>r.id===actor.roleId)?.key!=='business_owner')return 'Tiklayotgan biznes egasining roli yoki kirishi yo‘qoladi'
  return null
}
