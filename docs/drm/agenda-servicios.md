# Agenda de servicios de DRM

Primera entrega de agenda para el CRM web y la APK existente. Se registran citas con un contacto del CRM, referencia de unidad/Folio DRM, servicio, sucursal, fecha y hora, duración, responsable, kilometraje opcional y notas. Incluye estados Agendada, Confirmada, Realizada y Cancelada, vista de un día o siete días y filtro por responsable. Todas las fechas usan `America/Mexico_City`.

La referencia de unidad se introduce manualmente en esta etapa. No sincroniza ni modifica todavía las unidades o el historial del panel WordPress. El kilometraje es una lectura manual; no calcula automáticamente los kilómetros recorridos ni agenda el próximo servicio por kilometraje.

## Instalar la agenda

1. Revisar y aprobar los cambios de código antes del despliegue.
2. Ejecutar íntegramente `supabase/migrations/062_service_agenda.sql` en Supabase SQL Editor, fuente **Database**. No elimina citas ni datos existentes y admite reejecución.
3. Desplegar el CRM desde GitHub/Hostinger. No hace falta otra APK: reabrir la app muestra **Agenda** en el menú.
4. Los miembros owner/admin/agent pueden crear y editar; viewers solo consultar. Primero registrar el cliente en Contactos, después seleccionar ese contacto al crear la cita.
5. Asignar un responsable impide que tenga dos citas activas que se solapen. Las citas sin responsable pueden coincidir; esta versión no modela capacidad del taller, elevadores ni mecánicos ajenos al equipo del CRM.
6. Dos personas editando la misma cita no se sobrescriben: si la versión cambió, recargar antes de volver a guardar. Cancelar o realizar la cita retira su recordatorio pendiente.

## Activar recordatorios automáticos por WhatsApp

Los recordatorios permanecen sin ejecutar hasta configurar el programador. Guardar una cita con la casilla de aviso no envía un mensaje inmediatamente desde el formulario.

### Plantilla de Meta

Preparar en el CRM/Meta una plantilla de categoría **Utility**, nombre **`drm_recordatorio_servicio`**, idioma **`es_MX`**, formato de variables **posicional**. Debe aprobarla Meta y sincronizarse en el CRM. Cuerpo propuesto, con seis variables:

> Hola {{1}}, te recordamos la cita de servicio de tu unidad {{2}}: {{3}}, el {{4}} a las {{5}}, en {{6}}. Si necesitas cambiar tu cita, responde a este mensaje. DRM.

Orden: nombre del cliente, referencia de unidad, tipo de servicio, fecha local, hora local y sucursal/taller. Esta versión permite encabezado de texto fijo o sin encabezado y no utiliza botones. No crear la plantilla mediante cambios de código: el propietario debe revisar y aprobar su publicación en Meta.

Registrar autorización del cliente para esta cita marcando la casilla correspondiente. Si retira su autorización, desactivar el recordatorio o cancelar la cita. Continúan aplicándose las restricciones del número de prueba de Meta y la vigencia del token de WhatsApp.

### Programador en Supabase

1. Crear una clave privada aleatoria en Supabase Vault una sola vez, con SQL Editor:

```sql
SELECT vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'drm_agenda_cron_secret',
  'Autorización privada del programador de citas DRM'
)
WHERE NOT EXISTS (
  SELECT 1 FROM vault.decrypted_secrets WHERE name = 'drm_agenda_cron_secret'
);
```

2. Consultar su valor desde la cuenta administrativa de Supabase y copiarlo directamente a Hostinger como variable de servidor **`AGENDA_CRON_SECRET`**. No pegarlo en GitHub, capturas ni chats:

```sql
SELECT decrypted_secret
FROM vault.decrypted_secrets
WHERE name = 'drm_agenda_cron_secret';
```

3. Después de guardar la variable y desplegar el servidor, ejecutar `supabase/setup/service_agenda_schedule.sql`. Instala la tarea `drm-service-reminders`, que consulta cada minuto la ruta protegida del CRM. La definición pública del trabajo no contiene la clave; se lee de Vault al ejecutarse.
4. Para pausar los envíos automáticos: `SELECT cron.unschedule('drm-service-reminders');`. Volver a ejecutar el script de configuración para activarlos otra vez. No copiar un programador activo a entornos de prueba que apunten al CRM de producción.

El script usa las extensiones `pg_cron` y `pg_net` de Supabase. La agenda y los avisos Android ya existentes funcionan sin ese programador.

## Qué envía y cómo comprobarlo

- Solo se toman citas activas con contacto válido, autorización y recordatorio activado. Elegir 24 horas, 2 horas o 1 hora antes. Si la cita se crea dentro de ese margen, el aviso queda vencido para envío y lo toma el siguiente ciclo del programador, siempre que la cita aún sea futura.
- Cada ciclo procesa hasta tres avisos. Una cita que ya empezó no genera un recordatorio atrasado. El servidor comprueba de nuevo los datos y la plantilla antes de enviar.
- Los envíos usan el chat del contacto y la protección de idempotencia de mensajería. No cambian la asignación del chat ni pausan los flujos de bot activos.
- En la cita se ve Programado, Enviando, Enviado, No enviado o Revisar envío. Enviado significa que Meta aceptó el envío y se guardó el mensaje; la entrega/lectura final se consulta en el chat.
- Si falta plantilla/contacto/configuración antes de enviar, queda No enviado. Corregir la causa y volver a programar el aviso. Si se intentó enviar y hubo incertidumbre, queda Revisar envío; no se reintenta automáticamente. Revisar el chat antes de cambiar la programación para evitar duplicados. Una ejecución interrumpida pasa a revisión después de diez minutos.
- Editar solo notas conserva el resultado del aviso. Reprogramar una fecha o cambiar los datos del servicio prepara una nueva revisión del recordatorio, salvo los envíos que necesitan revisión. Editar durante un envío en curso se rechaza temporalmente.

Prueba con el destinatario autorizado de Meta: crear una cita futura dentro del margen del aviso, registrar consentimiento y esperar al programador. Verificar un solo mensaje en el chat, su estado en la cita, cancelación antes del envío, dos ciclos simultáneos, cambio de fecha y permisos del segundo agente/viewer.

Las pruebas locales usan datos ficticios y el emisor de Meta simulado. La aprobación de la plantilla, la instalación del cron, el envío real y la conexión con el panel de unidades requieren validación posterior en el entorno del propietario.

Referencias: [Supabase Cron](https://supabase.com/docs/guides/cron), [Vault y llamadas programadas](https://supabase.com/docs/guides/functions/schedule-functions), [plantillas de Meta](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/).
