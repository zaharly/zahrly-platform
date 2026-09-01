import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit3, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/layout/PageHeader'
import { StatusBadge } from '../../components/status/StatusBadge'
import { Button } from '../../lib/shadcn/button'
import { toast } from '../../lib/shadcn/sonner'
import { supabase } from '../../lib/supabase'

const db = supabase as any
const input = 'h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring'
const area = 'min-h-32 w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring'
const err = (e: unknown) => e instanceof Error ? e.message : 'Operation failed'
const text = (v: unknown) => v == null ? '—' : String(v)
const date = (v: unknown) => v ? new Date(String(v)).toLocaleString() : '—'

function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-density-lg shadow-retool-sm"><div className="mb-density-md flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2>{actions}</div>{children}</section>
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground"><span>{label}</span>{children}</label> }
function Input({ label, value, onChange, type = 'text' }: any) { return <Field label={label}><input className={input} type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} /></Field> }
function Area({ label, value, onChange }: any) { return <Field label={label}><textarea className={area} value={value ?? ''} onChange={e => onChange(e.target.value)} /></Field> }
function Select({ label, value, onChange, options }: any) { return <Field label={label}><select className={input} value={value ?? ''} onChange={e => onChange(e.target.value)}>{options.map((o: string) => <option key={o} value={o}>{o}</option>)}</select></Field> }
function Empty({ children }: { children: ReactNode }) { return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div> }
function Delete({ onDelete }: { onDelete: () => void }) { return <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Delete this record? This cannot be undone.')) onDelete() }}><Trash2 className="h-3.5 w-3.5" /></Button> }

const configs: Record<string, { table: string; title: string; path: string; columns: string[]; fields: string[] }> = {
  bonuses: { table: 'bonuses', title: 'Bonuses', path: '/bonuses', columns: ['title','brand_name','bonus_type','delivery_type','status','starts_at','expires_at'], fields: ['partner_id','brand_name','brand_logo_url','title','slug','description','bonus_type','delivery_type','code','affiliate_url','image_url','offer_value','terms','starts_at','expires_at','status','featured','sort_order','max_claims','bonus_access_type'] },
  giveaways: { table: 'giveaways', title: 'Giveaways', path: '/giveaways', columns: ['title','slug','giveaway_type','display_type','status','starts_at','ends_at'], fields: ['challenge_id','slug','title','subtitle','description','giveaway_type','status','starts_at','ends_at','featured','sort_order','image_url','cover_url','badge_text','prize_headline','participant_label','show_participant_count','show_winner_count','display_type','metadata'] },
  pickrush: { table: 'pickrush_contests', title: 'Pick Rush', path: '/pickrush', columns: ['id','status','starts_at','ends_at','participant_limit','required_matches','min_total_odds','max_total_odds'], fields: ['challenge_id','starts_at','ends_at','participant_limit','close_rule','platform_partner_id','platform_url','required_matches','min_total_odds','max_total_odds','virtual_stake','campaign_percent','metadata'] },
  prizepool: { table: 'prize_pool_campaigns', title: 'Prize Pool', path: '/prizepool', columns: ['title','slug','status','pool_amount','currency','rewarded_positions','starts_at','ends_at','process_at'], fields: ['challenge_id','slug','title','description','status','starts_at','ends_at','process_at','pool_amount','currency','rewarded_positions','leaderboard_metric','distribution_method','eligibility_mode','max_entries_per_user','min_account_age_days','featured','sort_order','image_url','cover_url','badge_text','prize_headline','participant_label','metadata','eligibility_rules'] },
  bookmakersradar: { table: 'bookmakers_radar', title: 'Bookmakers Radar', path: '/bookmakersradar', columns: ['name','slug','status','priority','radar_score','risk_level','confidence_level','trend','verified'], fields: ['partner_id','name','slug','short_name','logo_url','cover_url','website','license_name','license_verified','country','description','status','featured','sort_order','discovery_source','verified','priority','is_sharp','data_provider_enabled','metadata'] },
  leaderboards: { table: 'leaderboard_bots', title: 'Leaderboard Bots', path: '/leaderboards', columns: ['username','full_name','points','country','city','status','is_active'], fields: ['username','full_name','avatar_id','points','is_active','date_of_birth','country','city','address','facebook','telegram','whatsapp','bio','phone','status'] },
}

function value(v: any, key: string) { if (key.endsWith('_at') || key === 'date_of_birth') return date(v); return typeof v === 'object' && v !== null ? JSON.stringify(v) : text(v) }

function ResourcePage({ kind }: { kind: string }) {
  const c = configs[kind]
  const [rows,setRows] = useState<any[]>([])
  const [loading,setLoading] = useState(false)
  const load = async () => { setLoading(true); const { data, error } = await db.from(c.table).select('*').order('created_at', { ascending: false }); if (error) toast.error(err(error)); else setRows(data ?? []); setLoading(false) }
  useEffect(() => { void load() }, [c.table])
  const remove = async (r: any) => { const { error } = await db.from(c.table).delete().eq('id', r.id); if (error) toast.error(err(error)); else { toast.success('Deleted'); await load() } }
  return <div className="flex flex-col gap-density-lg"><PageHeader title={c.title} description={`CRUD administration for public.${c.table}.`} actions={<><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4"/>Refresh</Button><Button asChild><Link to={`${c.path}/new`}><Plus className="h-4 w-4"/>Create</Link></Button></>} /><Card title={`${c.title} (${rows.length})`}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground">{c.columns.map(x => <th key={x} className="py-2 pr-4">{x}</th>)}<th/></tr></thead><tbody>{rows.map(r => <tr key={r.id} className="border-b border-border/70">{c.columns.map(x => <td key={x} className="py-2 pr-4">{x === 'status' ? <StatusBadge status={r[x] ?? 'active'} dense/> : value(r[x],x)}</td>)}<td className="whitespace-nowrap text-right"><Button asChild size="sm" variant="ghost"><Link to={`${c.path}/${r.id}/edit`}><Edit3 className="h-3.5 w-3.5"/>Edit</Link></Button><Delete onDelete={() => void remove(r)}/></td></tr>)}</tbody></table>{!rows.length && <Empty>{loading ? 'Loading…' : 'No records yet.'}</Empty>}</div></Card></div>
}

function Editor({ kind }: { kind: string }) {
  const c = configs[kind]; const { id } = useParams(); const nav = useNavigate(); const editing = !!id
  const [record,setRecord] = useState<any>({}); const [saving,setSaving] = useState(false)
  useEffect(() => { if (!editing) return; void db.from(c.table).select('*').eq('id',id).single().then(({data,error}: any) => { if (error) toast.error(err(error)); else setRecord(data ?? {}) }) }, [c.table,id,editing])
  const set = (k:string,v:any) => setRecord((x:any) => ({ ...x, [k]: v }))
  const save = async (e:any) => { e.preventDefault(); setSaving(true); try { const payload:any = {}; for (const k of c.fields) { let v=record[k]; if (['metadata','eligibility_rules'].includes(k) && typeof v === 'string') v=JSON.parse(v || '{}'); if (v === '') v=null; payload[k]=v } const q = editing ? db.from(c.table).update(payload).eq('id',id) : db.from(c.table).insert(payload); const { error } = await q; if (error) throw error; toast.success(editing ? 'Updated' : 'Created'); nav(c.path) } catch (e) { toast.error(err(e)) } finally { setSaving(false) } }
  return <div className="flex flex-col gap-density-lg"><PageHeader title={`${editing ? 'Edit' : 'Create'} ${c.title}`} actions={<Button asChild variant="outline"><Link to={c.path}><ArrowLeft className="h-4 w-4"/>Back</Link></Button>} /><form onSubmit={save} className="flex flex-col gap-density-lg"><Card title="Configuration"><div className="grid gap-density-md md:grid-cols-2 xl:grid-cols-4">{c.fields.map(k => ['description','terms','bio'].includes(k) ? <Area key={k} label={k} value={record[k]} onChange={(v:string)=>set(k,v)}/> : ['status','bonus_type','delivery_type','bonus_access_type','giveaway_type','display_type','close_rule','leaderboard_metric','distribution_method','eligibility_mode','discovery_source'].includes(k) ? <Select key={k} label={k} value={record[k]} onChange={(v:string)=>set(k,v)} options={Array.from(new Set([text(record[k]),'draft','active','paused','ended','cancelled','archived','other','code','link','code_and_link','public','challenge','winner','general','social','prediction','time_only','participant_limit_only','time_or_limit','time_and_limit','manual','current_balance','lifetime_earned','equal','tiered','open','joined_only','admin','system','user_report','import'])).filter(Boolean)}/> : <Input key={k} label={k} value={record[k]} onChange={(v:string)=>set(k,v)} type={k.includes('_at') ? 'datetime-local' : k === 'date_of_birth' ? 'date' : ['points','sort_order','max_claims','participant_limit','required_matches','min_total_odds','max_total_odds','virtual_stake','campaign_percent','pool_amount','rewarded_positions','max_entries_per_user','min_account_age_days','priority'].includes(k) ? 'number' : 'text'}/>)}</div></Card><div className="flex justify-end"><Button type="submit" disabled={saving}><Save className="h-4 w-4"/>{saving ? 'Saving…' : 'Save'}</Button></div></form></div>
}

export const BonusesPage = () => <ResourcePage kind="bonuses" />
export const BonusEditor = () => <Editor kind="bonuses" />
export const GiveawaysPage = () => <ResourcePage kind="giveaways" />
export const GiveawayEditor = () => <Editor kind="giveaways" />
export const PickRushPage = () => <ResourcePage kind="pickrush" />
export const PickRushEditor = () => <Editor kind="pickrush" />
export const PrizePoolPage = () => <ResourcePage kind="prizepool" />
export const PrizePoolEditor = () => <Editor kind="prizepool" />
export const BookmakersRadarPage = () => <ResourcePage kind="bookmakersradar" />
export const BookmakerEditor = () => <Editor kind="bookmakersradar" />
export const LeaderboardsPage = () => <ResourcePage kind="leaderboards" />
export const LeaderboardBotEditor = () => <Editor kind="leaderboards" />
