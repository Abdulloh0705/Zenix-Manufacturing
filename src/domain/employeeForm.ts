import type {Employee,ManufacturingState,WorkCenter} from '../types'

/**
 * The "Yangi xodim / Xodimni tahrirlash" form as pure rules: which work centers may be picked, what is invalid, and
 * the payload handed to the existing `createEntity('employees')` / `updateEntity` actions. The domain write rules
 * (employeeWriteBlocker, entity references) still run on save; these only explain problems beside the right field.
 */
type S=Pick<ManufacturingState,'roles'|'workCenters'|'warehouses'>

export const EMPLOYEE_DEPARTMENTS=['Production','Quality','Maintenance','Warehouse','Procurement','Management'] as const
/** Departments that work at shop-floor work centers; the others are not offered one unless their role is bound to one. */
export const WORK_CENTER_DEPARTMENTS:readonly string[]=['Production','Quality','Maintenance']

export type EmployeeDraft={name:string;department:string;roleId:string;branchId:string;branchIds:string[];workCenterId:string;warehouseId:string;shift:string;status:string;hourlyCost:string;attendance:string}
export type EmployeeDraftErrors=Partial<Record<keyof EmployeeDraft,string>>

const roleScope=(s:S,roleId:string)=>s.roles.find(r=>r.id===roleId)?.scope

/** True when the draft's department or role uses a work center at all. */
export function usesWorkCenter(s:S,draft:Pick<EmployeeDraft,'department'|'roleId'>):boolean{
  return WORK_CENTER_DEPARTMENTS.includes(draft.department)||roleScope(s,draft.roleId)==='workcenter'
}

/**
 * Work centers offered for the draft: active ones in the employee's branches, for a department (or role) that uses one.
 * An employee's current work center stays offered while it is still in their branches, even if archived since —
 * the domain keeps unchanged references editable.
 */
export function employeeWorkCenterOptions(s:S,draft:Pick<EmployeeDraft,'department'|'roleId'|'branchIds'>,original?:Pick<Employee,'workCenterId'>):WorkCenter[]{
  if(!usesWorkCenter(s,draft))return []
  return s.workCenters.filter(w=>draft.branchIds.includes(w.branchId)&&(w.status!=='Arxiv'||w.id===original?.workCenterId))
}

/** Problem with the chosen work center, or undefined. Empty is fine unless the role is bound to a work center. */
export function workCenterError(s:S,draft:Pick<EmployeeDraft,'department'|'roleId'|'branchIds'|'workCenterId'>,original?:Pick<Employee,'workCenterId'>):string|undefined{
  if(!draft.workCenterId)return roleScope(s,draft.roleId)==='workcenter'?'Bu rol uchun ish markazini tanlang':undefined
  if(!s.workCenters.some(w=>w.id===draft.workCenterId))return 'Tanlangan ish markazi topilmadi'
  if(!employeeWorkCenterOptions(s,draft,original).some(w=>w.id===draft.workCenterId))return 'Bu ish markazi tanlangan filial yoki bo‘lim uchun mavjud emas'
  return undefined
}

/**
 * After the department, role or branches change: keeps the chosen work center while it is still offered, otherwise
 * clears it (never picks another one) and names what was removed so the form can say so.
 */
export function reconcileWorkCenter(s:S,draft:Pick<EmployeeDraft,'department'|'roleId'|'branchIds'|'workCenterId'>,original?:Pick<Employee,'workCenterId'>):{workCenterId:string;cleared?:string}{
  if(!draft.workCenterId||employeeWorkCenterOptions(s,draft,original).some(w=>w.id===draft.workCenterId))return {workCenterId:draft.workCenterId}
  return {workCenterId:'',cleared:s.workCenters.find(w=>w.id===draft.workCenterId)?.name||draft.workCenterId}
}

const number=(v:string)=>v.trim()===''?NaN:Number(v)

export function validateEmployeeDraft(s:S,draft:EmployeeDraft,original?:Pick<Employee,'workCenterId'>):EmployeeDraftErrors{
  const scope=roleScope(s,draft.roleId)
  const name=draft.name.trim()
  const cost=number(draft.hourlyCost),attendance=number(draft.attendance)
  return {
    name:!name?'F.I.Sh majburiy':name.split(/\s+/).length<2?'Ism va familiyani kiriting':undefined,
    roleId:!draft.roleId?'Rolni tanlang':undefined,
    branchId:scope!=='all'&&!draft.branchId?'Filialni tanlang':undefined,
    workCenterId:workCenterError(s,draft,original),
    warehouseId:scope==='warehouse'&&!draft.warehouseId?'Omborni tanlang':draft.warehouseId&&!s.warehouses.some(w=>w.id===draft.warehouseId)?'Tanlangan ombor topilmadi':undefined,
    hourlyCost:Number.isFinite(cost)&&cost>=0?undefined:'Stavka manfiy bo‘lmasligi kerak',
    attendance:Number.isFinite(attendance)&&attendance>=0&&attendance<=100?undefined:'0–100%',
  }
}

/** Fields written by `createEntity('employees')` / `updateEntity`; an unselected work center is stored as '' (none). */
export function employeePayload(draft:EmployeeDraft):Record<string,unknown>{
  return {...draft,name:draft.name.trim(),workCenterId:draft.workCenterId||'',warehouseId:draft.warehouseId||undefined,hourlyCost:Number(draft.hourlyCost),attendance:Number(draft.attendance)}
}
