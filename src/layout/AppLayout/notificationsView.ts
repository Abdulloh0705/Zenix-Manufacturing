import type {NotificationItem,SettingsState} from '../../types'

type Prefs=SettingsState['notifications']

/** Preference that governs a notification type (same mapping the engine uses when it creates them). */
export const NOTIFICATION_CATEGORY:Record<string,keyof Prefs|undefined>={'low-stock':'lowStock',quality:'quality',maintenance:'maintenance',delay:'delay',ai:'ai'}

/** Module a notification belongs to, from its link (a notification without a link goes by its type). */
export const notificationModule=(n:{path?:string;type:string})=>n.path?n.path.split('?')[0].replace(/^\//,'')||'dashboard':n.type.includes('low')?'materials':n.type.includes('quality')?'quality':n.type.includes('maintenance')?'equipment':n.type.includes('sales')?'sales':n.type.includes('purchase')?'purchases':'production'

/** Where a notification without its own link opens: the list it is about. */
export const fallbackPath=(type:string)=>type.includes('low')?'/materials?view=shortages':type.includes('quality')?'/quality?view=alerts':type.includes('maintenance')?'/equipment?view=maintenance':type.includes('sales')?'/sales?view=orders':type.includes('purchase')?'/purchases?view=orders':'/production?view=orders'

export const isReadBy=(n:NotificationItem,me:string)=>n.readBy?n.readBy.includes(me):n.read

/**
 * What the bell shows this person: only modules they may open (A-L1) and only categories they keep on
 * in Settings → Bildirishnomalar (turning a category off hides its older messages too, not only new ones).
 */
export function visibleNotifications(list:NotificationItem[],can:(module:string)=>boolean,prefs:Prefs){
  return list.filter(n=>{
    const category=NOTIFICATION_CATEGORY[n.type]
    if(category&&prefs[category]===false)return false
    return can(notificationModule(n))
  })
}

export function unreadCount(list:NotificationItem[],me:string){return list.filter(n=>!isReadBy(n,me)).length}
