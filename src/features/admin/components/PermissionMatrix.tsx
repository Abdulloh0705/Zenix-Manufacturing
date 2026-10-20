import {useApp} from '../../../app/providers/AppProvider/AppContext'
import {Icon} from '../../../shared/ui'
import type {Role} from '../../../types'
import {PERMISSION_ACTIONS,PERMISSION_MODULES,isSuperAdminRole,rolePermissionBlocker} from '../../../domain/access'
import {cls} from '../../../utils/format'

/**
 * Module × action matrix of one role. Every cell asks the same rule the domain enforces, so a switch the user
 * may not flip is shown disabled with the reason (own role, higher rank, a permission they do not hold).
 */
export function PermissionMatrix({role}:{role:Role}){
  const app=useApp(),s=app.state
  const canEdit=app.can('roles','edit')
  const locked=isSuperAdminRole(role)
  return <div className="table-scroll"><table className="permission-matrix">
    <thead><tr><th>Modul</th>{PERMISSION_ACTIONS.map(a=><th key={a.key} className="align-center">{a.label}</th>)}</tr></thead>
    <tbody>{PERMISSION_MODULES.map(m=><tr key={m.key}>
      <td><span className="perm-module"><Icon name={m.icon} size={15}/>{m.label}</span></td>
      {PERMISSION_ACTIONS.map(a=>{
        if(!m.actions.includes(a.key))return <td key={a.key} className="align-center"><span className="muted" aria-hidden="true">·</span></td>
        const on=locked||role.permissions?.[m.key]?.[a.key]===true
        const reason=!canEdit?'Ruxsatlarni o‘zgartirish uchun roles.edit huquqi kerak':rolePermissionBlocker(s,app.currentEmployee,role.id,m.key,a.key)
        return <td key={a.key} className="align-center"><button type="button" role="switch" aria-checked={on} aria-label={`${m.label}: ${a.label}`} title={reason||undefined} disabled={Boolean(reason)} className={cls('perm-toggle',on&&'on')} onClick={()=>app.updateRolePermission(role.id,m.key,a.key,!on)}><Icon name={on?'check':'minus'} size={13}/></button></td>
      })}
    </tr>)}</tbody>
  </table></div>
}
