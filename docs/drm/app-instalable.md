# DRM CRM instalable

La web incluye un manifiesto y un service worker para instalarla en la pantalla de inicio y abrirla en una ventana propia. Comparte la URL, las cuentas y el servidor del CRM; esta etapa no requiere cambios en Supabase ni variables de entorno nuevas.

## Instalación después del despliegue

1. Abre la URL HTTPS del CRM en el navegador del teléfono e inicia sesión.
2. Ve a **Configuración**. La tarjeta **Instalar DRM CRM** muestra el botón cuando el navegador permite solicitar la instalación.
3. En Android con Chrome también puedes usar el menú **Instalar aplicación** o **Agregar a pantalla de inicio**. En iPhone con Safari usa **Compartir → Agregar a pantalla de inicio** y activa **Abrir como app web** si aparece.
4. Abre el icono **DRM CRM**, comprueba la sesión y prueba recibir y enviar con el destinatario autorizado de Meta. Repite con el segundo agente y verifica el bloqueo por asignación.

El texto exacto del menú depende del navegador y del sistema. Si no aparece el botón, utiliza las instrucciones de instalación manual de la tarjeta.

## Conexión y notificaciones

Las conversaciones y los envíos necesitan internet. Sin conexión, una navegación muestra una página genérica con un botón para volver a intentar. El service worker almacena únicamente ese documento: no guarda conversaciones, archivos, respuestas de API ni sesiones. Al recuperar internet, vuelve a cargar la aplicación.

Esta etapa no agrega notificaciones push con la aplicación cerrada. Los avisos que ya existían con la página abierta conservan su comportamiento. Las notificaciones en segundo plano requieren una implementación posterior.

## Validación

- Manifiesto con nombre DRM CRM, inicio en `/inbox` y modo `standalone`.
- Iconos PNG de 192 y 512 píxeles, icono maskable de 512 y Apple de 180.
- Recursos de instalación públicos; las rutas del CRM conservan su autenticación.
- Registro del service worker solo en producción. Caché del documento genérico sin datos privados.
- Compilación de producción, comprobación de tipos y suite de pruebas.

La instalación final y la apertura desde el icono deben verificarse en un teléfono después del despliegue HTTPS.
