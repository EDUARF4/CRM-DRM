'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  Bell,
  BellOff,
  Ban,
  CheckCircle2,
  FileText,
  MessageCircle,
  Pencil,
  Store,
  Tag,
  Trash2,
  Users,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  RefreshCw,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  displayDate,
  displayTime,
  localToIso,
  mexicoLocal,
  REMINDER_STATES,
  STATUSES,
  type Appointment,
  type AppointmentValues,
} from '@/lib/agenda/model';

import { createClient } from '@/lib/supabase/client';
import {
  calendarDate,
  calendarPeriod,
  movePeriod,
  eventColor,
  EVENT_COLORS,
  type CalendarView,
} from '@/lib/agenda/calendar';
import { CalendarViewPanel } from './calendar-view';
import styles from './calendar.module.css';

interface Options {
  contacts: { id: string; name: string | null; phone: string }[];
  members: {
    user_id: string;
    full_name: string | null;
    account_role: string;
  }[];
  reminderReady: boolean;
}
interface Form extends Omit<AppointmentValues, 'starts_at' | 'ends_at'> {
  id: string;
  version: number;
  contact_name: string;
  local_start: string;
  duration: number;
}
const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
const emptyOptions: Options = {
  contacts: [],
  members: [],
  reminderReady: false,
};
function formFor(row: Appointment | null, day: string): Form {
  return row
    ? {
        ...row,
        local_start: mexicoLocal(row.starts_at),
        duration: Math.round(
          (Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000
        ),
      }
    : {
        id: crypto.randomUUID(),
        version: 0,
        contact_id: null,
        contact_name: '',
        assigned_agent_id: null,
        unit_reference: '',
        service_type: 'Servicio preventivo',
        location: 'Taller DRM',
        status: 'scheduled',
        odometer_km: null,
        notes: '',
        reminder_enabled: false,
        reminder_consent: false,
        reminder_minutes: 1440,
        local_start: `${day}T09:00`,
        duration: 60,
      };
}
async function responseData(response: Response) {
  const data = await response
    .json()
    .catch(() => ({ error: 'El servidor no respondió. Intenta de nuevo.' }));
  if (!response.ok)
    throw new Error(data.error ?? 'No se pudo completar la operación.');
  return data;
}

export default function AgendaPage() {
  const { accountId, accountRole } = useAuth();
  const canEdit = !!accountRole && accountRole !== 'viewer';
  const [day, setDay] = useState(() => mexicoLocal(new Date()).slice(0, 10));
  const [view, setView] = useState<CalendarView>('week');
  const [location, setLocation] = useState('');
  const [service, setService] = useState('');
  const [remindersOnly, setRemindersOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<{
    contact: string;
    id: string | null;
    error: boolean;
  } | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [action, setAction] = useState<{
    kind: 'reminder' | 'cancel' | 'delete';
    row: Appointment;
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const period = calendarPeriod(day, view);
  const periodFrom = period.from,
    periodTo = period.to;
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setView('day');
  }, []);
  const [agent, setAgent] = useState('');
  const [rows, setRows] = useState<Appointment[]>([]);
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener('focus', reload);
    window.addEventListener('drm-native-resume', reload);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('drm-native-resume', reload);
    };
  }, []);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    let from: string, to: string;
    try {
      from = localToIso(`${periodFrom}T00:00`);
      to = localToIso(`${periodTo}T00:00`);
    } catch {
      setError('Selecciona una fecha válida.');
      setLoading(false);
      return;
    }
    const params = new URLSearchParams({ from, to });
    if (agent) params.set('agent', agent);
    void fetch(`/api/agenda/appointments?${params}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(responseData)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRows(data.appointments);
          setTruncated(data.truncated);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [accountId, periodFrom, periodTo, agent, refresh]);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/agenda/options?q=${encodeURIComponent(search)}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(responseData)
        .then((data) => {
          if (!controller.signal.aborted) {
            setOptions(data);
            setOptionsLoaded(true);
            setOptionsError('');
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setOptionsError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accountId, search, refresh]);
  const open = (row: Appointment | null) => {
    setSearch('');
    setSaveError('');
    setForm(formFor(row, day));
  };
  const change = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : null));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const starts_at = localToIso(form.local_start);
      const ends_at = new Date(
        Date.parse(starts_at) + form.duration * 60000
      ).toISOString();
      const response = await fetch(
        form.version
          ? `/api/agenda/appointments/${form.id}`
          : '/api/agenda/appointments',
        {
          method: form.version ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, starts_at, ends_at }),
        }
      );
      const data = await responseData(response);
      setSelectedId(data.appointment.id);
      setDay(form.local_start.slice(0, 10));
      setNotice('Cita guardada.');
      setForm(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };
  const locations = [...new Set(rows.map((r) => r.location))].sort();
  const services = [...new Set(rows.map((r) => r.service_type))].sort();
  const visible = rows.filter(
    (row) =>
      (!location || row.location === location) &&
      (!service || row.service_type === service) &&
      (!remindersOnly || row.reminder_enabled)
  );
  const selected =
    !loading && !error
      ? (visible.find((r) => r.id === selectedId) ?? visible[0])
      : undefined;
  const selectedContact = selected?.contact_id;
  useEffect(() => {
    if (!accountId || !selectedContact) return;
    let live = true;
    const db = createClient();
    void db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', selectedContact)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (live)
          setConversation({
            contact: selectedContact,
            id: data?.id ?? null,
            error: !!queryError,
          });
      });
    return () => {
      live = false;
    };
  }, [accountId, selectedContact, refresh]);
  const chat = conversation?.contact === selectedContact ? conversation : null;
  const memberName = (id: string | null) =>
    id
      ? options.members.find((m) => m.user_id === id)?.full_name ||
        'Responsable no disponible'
      : 'Sin asignar';
  const selectAppointment = (row: Appointment) => {
    setSelectedId(row.id);
    if (window.matchMedia('(max-width: 1279px)').matches)
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      );
  };
  const requestAction = (
    kind: 'reminder' | 'cancel' | 'delete',
    row: Appointment
  ) => {
    setActionError('');
    setAction({ kind, row });
  };
  const performAction = async () => {
    if (!action || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    try {
      const response = await fetch(
        `/api/agenda/appointments/${action.row.id}`,
        {
          method: action.kind === 'delete' ? 'DELETE' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            action.kind === 'delete'
              ? { version: action.row.version }
              : {
                  ...action.row,
                  reminder_enabled: false,
                  ...(action.kind === 'cancel' ? { status: 'cancelled' } : {}),
                }
          ),
        }
      );
      await responseData(response);
      setNotice(
        action.kind === 'delete'
          ? 'Cita eliminada.'
          : action.kind === 'cancel'
            ? 'Cita cancelada. Se detuvo su recordatorio pendiente.'
            : 'Recordatorio cancelado. La cita sigue en la agenda.'
      );
      setAction(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : 'No se pudo completar la acción.'
      );
    } finally {
      setActionBusy(false);
    }
  };
  const today = mexicoLocal(new Date()).slice(0, 10);
  const counts = {
    active: visible.filter((r) => ['scheduled', 'confirmed'].includes(r.status))
      .length,
    completed: visible.filter((r) => r.status === 'completed').length,
    reminders: visible.filter((r) => r.reminder_state === 'pending').length,
  };
  const upcoming = visible
    .filter(
      (r) =>
        ['scheduled', 'confirmed'].includes(r.status) &&
        Date.parse(r.ends_at) > Date.now()
    )
    .slice(0, 4);
  const periodLabel =
    view === 'month'
      ? calendarDate(day, { month: 'long', year: 'numeric' })
      : view === 'day'
        ? calendarDate(day, { day: 'numeric', month: 'long', year: 'numeric' })
        : `${calendarDate(period.from, { day: 'numeric', month: 'short' })} – ${calendarDate(period.dates[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const palette = selected
    ? eventColor(selected.service_type)
    : EVENT_COLORS.workshop;
  return (
    <div className={styles.agenda}>
      <div className={styles.heading}>
        <div>
          <h1>Agenda DRM</h1>
          <p className={styles.subtitle}>
            Organiza citas, servicios y seguimientos de tu equipo.
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="outline"
            className={styles.reminderButton}
            aria-pressed={remindersOnly}
            onClick={() => setRemindersOnly((v) => !v)}
          >
            <Bell size={18} /> Recordatorios
          </Button>
          {canEdit && (
            <Button className={styles.redButton} onClick={() => open(null)}>
              <Plus size={19} /> Nueva cita
            </Button>
          )}
        </div>
      </div>
      <div className={styles.filters}>
        <label className={styles.filter}>
          <Users size={19} />
          <select
            aria-label="Filtrar por asesor"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="">Todos los asesores</option>
            {options.members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name || 'Agente'}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filter}>
          <Store size={19} />
          <select
            aria-label="Filtrar por sucursal"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option value="">Todas las sucursales</option>
            {[...new Set([...locations, ...(location ? [location] : [])])].map(
              (l) => (
                <option key={l}>{l}</option>
              )
            )}
          </select>
        </label>
        <label className={styles.filter}>
          <Tag size={19} />
          <select
            aria-label="Filtrar por tipo"
            value={service}
            onChange={(e) => setService(e.target.value)}
          >
            <option value="">Todos los tipos</option>
            {[...new Set([...services, ...(service ? [service] : [])])].map(
              (t) => (
                <option key={t}>{t}</option>
              )
            )}
          </select>
        </label>
        <div
          className={styles.views}
          role="group"
          aria-label="Vista del calendario"
        >
          {(
            [
              ['day', 'Día'],
              ['week', 'Semana'],
              ['month', 'Mes'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {optionsError && (
        <p role="alert" className={styles.notice}>
          {optionsError}
        </p>
      )}
      {optionsLoaded && !options.reminderReady && !optionsError && (
        <p className={styles.notice}>
          Para enviar avisos, sincroniza la plantilla aprobada de recordatorio
          en Meta.{' '}
          <Link className="underline" href="/settings">
            Abrir Configuración
          </Link>
        </p>
      )}
      {remindersOnly && (
        <div className={styles.notice}>
          Mostrando citas con recordatorio en este periodo.{' '}
          <button className="underline" onClick={() => setRemindersOnly(false)}>
            Ver todas las citas
          </button>
        </div>
      )}
      <div className={styles.workspace}>
        <section
          className={styles.calendar}
          aria-label="Calendario de citas"
          aria-busy={loading}
        >
          <div className={styles.toolbar}>
            <Button variant="outline" onClick={() => setDay(today)}>
              Hoy
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Periodo anterior"
              onClick={() => setDay(movePeriod(day, view, -1))}
            >
              <ChevronLeft size={18} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Periodo siguiente"
              onClick={() => setDay(movePeriod(day, view, 1))}
            >
              <ChevronRight size={18} />
            </Button>
            <h2 className={styles.period}>{periodLabel}</h2>
            <Input
              className={styles.dateInput}
              type="date"
              aria-label="Ir a fecha"
              value={day}
              min="2023-01-01"
              max="2100-12-31"
              onChange={(e) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))
                  setDay(e.target.value);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Actualizar agenda"
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
          {error ? (
            <div role="alert" className="p-6 text-sm">
              <p>{error}</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => setRefresh((v) => v + 1)}
              >
                Volver a intentar
              </Button>
            </div>
          ) : loading ? (
            <p
              role="status"
              className="text-muted-foreground py-24 text-center text-sm"
            >
              Cargando agenda…
            </p>
          ) : (
            <CalendarViewPanel
              day={day}
              today={today}
              view={view}
              rows={visible}
              selectedId={selected?.id ?? null}
              memberName={memberName}
              onSelect={selectAppointment}
              onDay={(date) => {
                setDay(date);
                setView('day');
              }}
            />
          )}
          <div className={styles.legend}>
            {Object.values(EVENT_COLORS).map((c) => (
              <span key={c.label}>
                <i className={styles.dot} style={{ background: c.color }} />
                {c.label}
              </span>
            ))}
          </div>
        </section>
        <div className={styles.side}>
          <section
            className={styles.detail}
            aria-label="Detalle de la cita"
            ref={detailRef}
            style={
              {
                '--event-color': palette.color,
                '--event-bg': palette.background,
              } as CSSProperties
            }
          >
            <h2>Detalle de la cita</h2>
            {selected ? (
              <>
                <span className={styles.badge}>{selected.service_type}</span>
                <h3 className={styles.client}>{selected.contact_name}</h3>
                <p className={styles.unit}>{selected.unit_reference}</p>
                <dl className={styles.details}>
                  <div>
                    <CalendarDays />
                    <dt>Fecha</dt>
                    <dd>
                      {displayDate(selected.starts_at)}
                      {mexicoLocal(selected.ends_at).slice(0, 10) !==
                        mexicoLocal(selected.starts_at).slice(0, 10) && (
                        <> – {displayDate(selected.ends_at)}</>
                      )}
                    </dd>
                  </div>
                  <div>
                    <Clock />
                    <dt>Horario</dt>
                    <dd>
                      {displayTime(selected.starts_at)} –{' '}
                      {displayTime(selected.ends_at)} · México
                    </dd>
                  </div>
                  <div>
                    <UserRound />
                    <dt>Asesor</dt>
                    <dd>{memberName(selected.assigned_agent_id)}</dd>
                  </div>
                  <div>
                    <Store />
                    <dt>Sucursal</dt>
                    <dd>{selected.location}</dd>
                  </div>
                  <div>
                    <CheckCircle2 />
                    <dt>Estado</dt>
                    <dd>
                      <span className={styles.status}>
                        <i
                          className={styles.dot}
                          style={{
                            background:
                              selected.status === 'confirmed' ||
                              selected.status === 'completed'
                                ? '#08a653'
                                : selected.status === 'cancelled'
                                  ? '#8b8b98'
                                  : '#f59e0b',
                          }}
                        />
                        {STATUSES[selected.status]}
                      </span>
                    </dd>
                  </div>
                  {selected.odometer_km !== null && (
                    <div>
                      <Wrench />
                      <dt>Lectura</dt>
                      <dd>{selected.odometer_km.toLocaleString('es-MX')} km</dd>
                    </div>
                  )}
                </dl>
                {selected.notes && (
                  <div className={styles.notes}>
                    <p className="flex items-center gap-2">
                      <FileText size={15} /> Notas
                    </p>
                    <blockquote>{selected.notes}</blockquote>
                  </div>
                )}
                <div className={styles.reminder}>
                  <p>
                    <Bell size={17} /> WhatsApp:{' '}
                    {REMINDER_STATES[selected.reminder_state]}
                  </p>
                  {selected.reminder_enabled && (
                    <small>
                      {selected.reminder_minutes === 1440
                        ? '24 horas'
                        : selected.reminder_minutes === 120
                          ? '2 horas'
                          : '1 hora'}{' '}
                      antes de la cita
                    </small>
                  )}
                  {selected.reminder_error && (
                    <p className={styles.reminderError}>
                      {selected.reminder_error}
                    </p>
                  )}
                </div>
                <div className={styles.detailActions}>
                  {chat?.id ? (
                    <Link
                      className={styles.chatLink}
                      href={`/inbox?c=${chat.id}`}
                    >
                      <MessageCircle size={19} /> Abrir conversación
                    </Link>
                  ) : (
                    <span
                      className={`${styles.chatLink} ${styles.disabledChat}`}
                    >
                      {!selected.contact_id
                        ? 'Contacto no disponible'
                        : !chat
                          ? 'Buscando conversación…'
                          : chat.error
                            ? 'No se pudo consultar el chat'
                            : 'Aún no hay conversación'}
                    </span>
                  )}
                  {canEdit && (
                    <>
                      <Button variant="outline" onClick={() => open(selected)}>
                        <Pencil size={15} /> Editar cita
                      </Button>
                      <Button variant="outline" onClick={() => open(selected)}>
                        <CalendarDays size={15} /> Reprogramar
                      </Button>
                    </>
                  )}
                </div>
                {canEdit && (
                  <div className={styles.management}>
                    {selected.reminder_enabled &&
                      !['sent', 'disabled'].includes(
                        selected.reminder_state
                      ) && (
                        <button
                          disabled={selected.reminder_state === 'sending'}
                          onClick={() => requestAction('reminder', selected)}
                        >
                          <BellOff size={14} /> Cancelar recordatorio
                        </button>
                      )}
                    {!['completed', 'cancelled'].includes(selected.status) && (
                      <button
                        disabled={selected.reminder_state === 'sending'}
                        onClick={() => requestAction('cancel', selected)}
                      >
                        <Ban size={14} /> Cancelar cita
                      </button>
                    )}
                    <button
                      className={styles.delete}
                      disabled={selected.reminder_state === 'sending'}
                      onClick={() => requestAction('delete', selected)}
                    >
                      <Trash2 size={14} /> Eliminar cita
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.emptyDetail}>
                <CalendarDays size={30} />
                <p>Selecciona una cita del calendario para ver sus detalles.</p>
              </div>
            )}
          </section>
          <section className={styles.upcoming}>
            <h2>Próximas citas</h2>
            <p>Dentro del periodo y los filtros seleccionados.</p>
            {!loading &&
              !error &&
              upcoming.map((row) => (
                <button
                  key={row.id}
                  className={styles.upcomingButton}
                  onClick={() => selectAppointment(row)}
                >
                  <span>
                    <strong>{row.contact_name}</strong>
                    <small>
                      {calendarDate(mexicoLocal(row.starts_at).slice(0, 10), {
                        day: 'numeric',
                        month: 'short',
                      })}{' '}
                      · {displayTime(row.starts_at)} · {row.service_type}
                    </small>
                  </span>
                  <ChevronRight size={16} className="shrink-0" />
                </button>
              ))}
            {!loading && !error && !upcoming.length && (
              <p className="py-4">No hay próximas citas en este periodo.</p>
            )}
          </section>
        </div>
      </div>
      {!loading && !error && (
        <div className={styles.summary}>
          <span>{visible.length} citas</span>
          <span>{counts.active} activas</span>
          <span>{counts.completed} realizadas</span>
          <span>{counts.reminders} avisos pendientes</span>
          <span>Hora de Ciudad de México</span>
        </div>
      )}
      {truncated && (
        <p role="status" className={`${styles.notice} mt-3`}>
          Se muestran las primeras 200 citas. Selecciona un día o filtra por
          asesor para consultar el resto.
        </p>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !actionBusy) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.kind === 'delete'
                ? '¿Eliminar esta cita?'
                : action?.kind === 'cancel'
                  ? '¿Cancelar esta cita?'
                  : '¿Cancelar el recordatorio?'}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === 'delete'
                ? 'La cita se borrará definitivamente de la agenda y se detendrá su recordatorio pendiente. Los mensajes ya enviados permanecerán en el chat.'
                : action?.kind === 'cancel'
                  ? 'La cita quedará como cancelada y conservará su historial. Se detendrá cualquier recordatorio pendiente; los mensajes ya enviados permanecerán en el chat.'
                  : 'Se detendrá el aviso pendiente. La cita conservará su fecha y horario. Un mensaje que ya haya salido no puede retirarse.'}
            </DialogDescription>
          </DialogHeader>
          {action && (
            <p className="rounded-lg border p-3 text-sm">
              {action.row.contact_name}
              <br />
              {displayDate(action.row.starts_at)} ·{' '}
              {displayTime(action.row.starts_at)}
            </p>
          )}
          {actionError && (
            <p role="alert" className="text-destructive text-sm">
              {actionError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={actionBusy}
              onClick={() => setAction(null)}
            >
              Volver
            </Button>
            <Button
              variant={action?.kind === 'delete' ? 'destructive' : 'default'}
              disabled={actionBusy}
              onClick={performAction}
            >
              {actionBusy
                ? 'Procesando…'
                : action?.kind === 'delete'
                  ? 'Eliminar definitivamente'
                  : action?.kind === 'cancel'
                    ? 'Confirmar cancelación'
                    : 'Cancelar recordatorio'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!form}
        onOpenChange={(value) => {
          if (!value && !saving) setForm(null);
        }}
      >
        <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {form?.version ? 'Editar cita' : 'Nueva cita de servicio'}
            </DialogTitle>
            <DialogDescription>
              La fecha y hora se guardan con la zona de Ciudad de México.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="space-y-4">
              <fieldset disabled={saving} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm sm:col-span-2">
                    Buscar contacto
                    <Input
                      className="mt-1"
                      placeholder="Nombre o teléfono"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <label className="text-sm sm:col-span-2">
                    Cliente
                    <select
                      required={!form.version || !!form.contact_id}
                      className={`${selectClass} mt-1`}
                      value={form.contact_id ?? ''}
                      onChange={(e) => {
                        const selected = options.contacts.find(
                          (c) => c.id === e.target.value
                        );
                        setForm({
                          ...form,
                          contact_id: e.target.value || null,
                          contact_name:
                            selected?.name ||
                            selected?.phone ||
                            form.contact_name,
                        });
                      }}
                    >
                      <option value="">Seleccionar contacto</option>
                      {form.contact_id && (
                        <option value={form.contact_id}>
                          {form.contact_name}
                        </option>
                      )}
                      {options.contacts
                        .filter((c) => c.id !== form.contact_id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name || c.phone} · {c.phone}
                          </option>
                        ))}
                    </select>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      ¿No está registrado? Agrégalo primero en Contactos.
                    </span>
                  </label>
                  <label className="text-sm">
                    Folio DRM / unidad
                    <Input
                      required
                      maxLength={120}
                      className="mt-1"
                      placeholder="Folio, serie o identificación"
                      value={form.unit_reference}
                      onChange={(e) => change('unit_reference', e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Servicio
                    <Input
                      required
                      maxLength={120}
                      className="mt-1"
                      value={form.service_type}
                      onChange={(e) => change('service_type', e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Fecha y hora
                    <Input
                      required
                      className="mt-1 min-w-0"
                      type="datetime-local"
                      value={form.local_start}
                      onChange={(e) => change('local_start', e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Duración
                    <select
                      className={`${selectClass} mt-1`}
                      value={form.duration}
                      onChange={(e) =>
                        change('duration', Number(e.target.value))
                      }
                    >
                      {[...new Set([30, 60, 90, 120, 180, 240, form.duration])]
                        .sort((a, b) => a - b)
                        .map((n) => (
                          <option key={n} value={n}>
                            {n} minutos
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Taller / sucursal
                    <Input
                      required
                      maxLength={200}
                      className="mt-1"
                      value={form.location}
                      onChange={(e) => change('location', e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Responsable
                    <select
                      className={`${selectClass} mt-1`}
                      value={form.assigned_agent_id ?? ''}
                      onChange={(e) =>
                        change('assigned_agent_id', e.target.value || null)
                      }
                    >
                      <option value="">Sin asignar</option>
                      {options.members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name || 'Agente'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Estado
                    <select
                      className={`${selectClass} mt-1`}
                      value={form.status}
                      onChange={(e) =>
                        change('status', e.target.value as Form['status'])
                      }
                    >
                      {Object.entries(STATUSES).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Kilometraje actual (opcional)
                    <Input
                      className="mt-1"
                      type="number"
                      min={0}
                      max={2000000}
                      step={1}
                      value={form.odometer_km ?? ''}
                      onChange={(e) =>
                        change(
                          'odometer_km',
                          e.target.value === '' ? null : Number(e.target.value)
                        )
                      }
                    />
                  </label>
                </div>
                <label className="block text-sm">
                  Notas
                  <Textarea
                    className="mt-1"
                    maxLength={2000}
                    value={form.notes}
                    onChange={(e) => change('notes', e.target.value)}
                  />
                </label>
                <div className="space-y-3 rounded-lg border p-4">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      className="mt-1 h-4 w-4 accent-red-600"
                      type="checkbox"
                      checked={form.reminder_enabled}
                      onChange={(e) =>
                        change('reminder_enabled', e.target.checked)
                      }
                    />
                    Enviar recordatorio por WhatsApp
                  </label>
                  {form.reminder_enabled && (
                    <>
                      <label className="block text-sm">
                        Anticipación
                        <select
                          className={`${selectClass} mt-1`}
                          value={form.reminder_minutes}
                          onChange={(e) =>
                            change('reminder_minutes', Number(e.target.value))
                          }
                        >
                          <option value={1440}>24 horas antes</option>
                          <option value={120}>2 horas antes</option>
                          <option value={60}>1 hora antes</option>
                        </select>
                      </label>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          required
                          className="mt-1 h-4 w-4 accent-red-600"
                          type="checkbox"
                          checked={form.reminder_consent}
                          onChange={(e) =>
                            change('reminder_consent', e.target.checked)
                          }
                        />
                        El cliente autorizó recibir el recordatorio de esta cita
                        por WhatsApp.
                      </label>
                      <p className="text-muted-foreground text-xs">
                        El envío automático necesita la plantilla aprobada y el
                        programador de recordatorios configurado. El resultado
                        se muestra en esta cita.
                      </p>
                    </>
                  )}
                </div>
              </fieldset>
              {saveError && (
                <p role="alert" className="text-destructive text-sm">
                  {saveError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setForm(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar cita'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
