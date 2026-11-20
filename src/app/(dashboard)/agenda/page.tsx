'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
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
  shiftDay,
  STATUSES,
  type Appointment,
  type AppointmentValues,
} from '@/lib/agenda/model';

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
  const [days, setDays] = useState(7);
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
      from = localToIso(`${day}T00:00`);
      to = localToIso(`${shiftDay(day, days)}T00:00`);
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
  }, [accountId, day, days, agent, refresh]);
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
      await responseData(response);
      setForm(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };
  const grouped = rows.reduce<Record<string, Appointment[]>>((groups, row) => {
    const date = mexicoLocal(row.starts_at).slice(0, 10);
    (groups[date] ??= []).push(row);
    return groups;
  }, {});
  const counts = {
    active: rows.filter((r) => ['scheduled', 'confirmed'].includes(r.status))
      .length,
    completed: rows.filter((r) => r.status === 'completed').length,
    reminders: rows.filter((r) => r.reminder_state === 'pending').length,
  };
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="text-primary h-6 w-6" />
            <h1 className="text-2xl font-semibold">Agenda de servicios</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Citas del taller y recordatorios por WhatsApp · Hora de México
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => open(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva cita
          </Button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {[
          ['Citas activas', counts.active],
          ['Realizadas', counts.completed],
          ['Avisos pendientes', counts.reminders],
        ].map(([label, count]) => (
          <div key={label} className="bg-card rounded-xl border p-3 sm:p-4">
            <p className="text-muted-foreground text-xs sm:text-sm">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{count}</p>
          </div>
        ))}
      </div>
      <div className="bg-card flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Periodo anterior"
            onClick={() => setDay(shiftDay(day, -days))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => setDay(mexicoLocal(new Date()).slice(0, 10))}
          >
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Periodo siguiente"
            onClick={() => setDay(shiftDay(day, days))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <label className="min-w-36 flex-1 text-sm">
          Desde
          <Input
            className="mt-1"
            type="date"
            value={day}
            onChange={(e) => {
              if (e.target.value) setDay(e.target.value);
            }}
          />
        </label>
        <label className="min-w-28 text-sm">
          Vista
          <select
            className={`${selectClass} mt-1`}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>Un día</option>
            <option value={7}>7 días</option>
          </select>
        </label>
        <label className="min-w-40 flex-1 text-sm">
          Responsable
          <select
            className={`${selectClass} mt-1`}
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="">Todo el equipo</option>
            {options.members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name || 'Agente'}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          size="icon"
          aria-label="Actualizar agenda"
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {optionsError && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {optionsError}
        </p>
      )}
      {optionsLoaded && !options.reminderReady && !optionsError && (
        <p className="bg-muted/30 text-muted-foreground rounded-lg border p-3 text-sm">
          Para enviar avisos necesitamos aprobar y sincronizar la plantilla de
          recordatorio en Meta. Puedes registrar las citas desde ahora.{' '}
          <Link className="underline" href="/settings">
            Abrir Configuración
          </Link>
        </p>
      )}
      {error ? (
        <div role="alert" className="rounded-xl border p-5">
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
        <p role="status" className="text-muted-foreground py-12 text-center">
          Cargando agenda…
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed px-5 py-14 text-center">
          <CalendarDays className="text-muted-foreground mx-auto mb-3 h-9 w-9" />
          <h2 className="font-semibold">No hay citas en este periodo</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Cambia la fecha o registra la próxima visita al taller.
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([date, appointments]) => (
          <section key={date} className="space-y-3">
            <h2 className="text-sm font-semibold capitalize">
              {displayDate(appointments[0].starts_at)}
            </h2>
            {appointments.map((row) => (
              <article
                key={row.id}
                className={`bg-card rounded-xl border p-4 ${row.status === 'cancelled' ? 'opacity-65' : ''}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Clock className="text-primary h-4 w-4" />
                      {displayTime(row.starts_at)}–{displayTime(row.ends_at)}
                    </p>
                    <h3 className="mt-2 font-semibold break-words">
                      {row.contact_name}
                    </h3>
                    <p className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
                      <Wrench className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 break-words">
                        {row.unit_reference} · {row.service_type}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${row.status === 'completed' ? 'bg-green-500/15 text-green-600' : row.status === 'cancelled' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}
                  >
                    {STATUSES[row.status]}
                  </span>
                </div>
                <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  <span className="flex max-w-full min-w-0 items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    <span className="min-w-0 break-words">{row.location}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <UserRound className="h-4 w-4" />
                    {row.assigned_agent_id
                      ? options.members.find(
                          (m) => m.user_id === row.assigned_agent_id
                        )?.full_name || 'Responsable no disponible'
                      : 'Sin asignar'}
                  </span>
                  {row.odometer_km !== null && (
                    <span>{row.odometer_km.toLocaleString('es-MX')} km</span>
                  )}
                </div>
                {row.notes && (
                  <p className="mt-3 text-sm break-words whitespace-pre-wrap">
                    {row.notes}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <div className="text-muted-foreground text-xs">
                    <p>WhatsApp: {REMINDER_STATES[row.reminder_state]}</p>
                    {row.reminder_error && (
                      <p className="text-destructive mt-1 max-w-xl">
                        {row.reminder_error}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open(row)}
                    >
                      Ver / editar
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </section>
        ))
      )}
      {truncated && (
        <p className="text-muted-foreground text-sm">
          Se muestran las primeras 200 citas. Elige la vista de un día o filtra
          por responsable.
        </p>
      )}
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
                      className="mt-1"
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
