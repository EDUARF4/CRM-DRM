# DRM: primera mejora de mensajería

Estado: preparado y validado localmente sobre EDUARF4/CRM-DRM, base 3a5b1e7.
No se ha desplegado en Hostinger ni aplicado SQL en Supabase.

## Cambios

- México: `521` seguido de diez dígitos nacionales se reconoce como el mismo
  teléfono que `52` seguido de esos diez dígitos. Se normalizan nuevas altas,
  importación CSV, recepción y envíos. No se cambia la numeración de otros países.
- La búsqueda encuentra contactos ya guardados en cualquiera de esos formatos.
  El índice de base de datos evita altas simultáneas duplicadas por 52/521.
- La asignación usa el valor que vio el agente: si otro compañero la cambió,
  se rechaza el cambio obsoleto y se pide actualizar la conversación.
- El servidor rechaza respuestas de un usuario a una conversación asignada a
  otro agente. Se puede transferir usando el selector existente. Las
  conversaciones sin asignar mantienen el comportamiento anterior.
- Texto, imágenes, audio, documentos, botones y plantillas enviados desde la
  bandeja o ficha del contacto incluyen un identificador de envío.
- Dos solicitudes con el mismo identificador producen como máximo un intento
  aceptado por Meta. Una solicitud completada devuelve su resultado anterior.
  La reserva se guarda en PostgreSQL y funciona entre procesos del servidor.
- Los reintentos de webhook entrante conservan la protección existente de la
  migración 037: no se cambió ese mecanismo.

## Aplicación en el entorno de prueba

1. Revisar el cambio de código de esta rama antes de subirlo. Hostinger puede
   desplegar automáticamente si se actualiza la rama que tiene conectada.
2. Ejecutar solamente `supabase/migrations/060_drm_messaging_reliability.sql`
   en SQL Editor del proyecto Supabase que usa este CRM. No repetir el archivo
   de instalación inicial de la base de datos.
3. Si el SQL informa que hay duplicados 52/521, la transacción se cancela sin
   borrar datos. Revisar esos contactos y su historial antes de continuar.
4. Desplegar el código de esta rama y actualizar las pestañas de los agentes.
   No se necesitan nuevas variables de entorno. La clave de servicio de
   Supabase permanece exclusivamente en el servidor.
5. Probar con el número de prueba de Meta y dos cuentas del mismo negocio:
   recepción de 521 sobre un contacto 52, respuesta, transferencia, cambio
   simultáneo de agente y envío de una plantilla. Confirmar en el teléfono
   destinatario que los mensajes llegan una sola vez.

## Resultado incierto y reintentos

Una desconexión puede ocurrir después de que Meta aceptó un mensaje. En ese caso
la reserva NO caduca ni dispara reintentos automáticos: se debe revisar el chat.
Si Meta devuelve un rechazo estructurado 4xx, se libera la reserva porque no
hubo entrega aceptada. Un fallo al guardar después de enviar conserva la reserva.

La protección se aplica al MISMO identificador, no a todo texto repetido. Es
válido que un agente escriba dos mensajes iguales a propósito. El navegador
conserva el identificador de un intento incierto mientras esa página siga abierta;
si se recarga o se cambia de dispositivo se debe revisar el chat antes de repetir.
No es una garantía de entrega exactamente una vez de extremo a extremo.

Clientes de `/api/v1/messages` pueden enviar `Idempotency-Key` (16–128 caracteres,
letras, números, guion o guion bajo). Deben reutilizar la clave y el mismo contenido
al reintentar. Sin esa cabecera se conserva la compatibilidad anterior. Esta
entrega no introduce una cola general para difusiones, automatizaciones o flujos.

## Validación

- Suite completa de Vitest, TypeScript y compilación de producción.
- Casos nuevos: equivalencia 52/521, importación de duplicados, identidad entrante,
  asignación simultánea, envío concurrente con una sola llamada externa, repetición
  de resultado, aislamiento de cuenta, conflicto de contenido, timeout y fallo al
  guardar después de enviar.
- Migración ejecutada en PostgreSQL embebido PGlite con esquema mínimo de prueba:
  unicidad 52/521 por cuenta, clave de reserva, permisos/RLS, segunda ejecución y
  rechazo de duplicados previos sin eliminación de contactos.
- Pendiente: aplicar en Supabase real y probar con Meta/Hostinger y dos agentes.
  Las pruebas automáticas de mensajes usan Meta simulado y no envían a clientes.
