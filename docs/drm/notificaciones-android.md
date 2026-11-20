# Notificaciones Android — DRM CRM

Estado: integración preparada para revisión. Falta configurar la credencial privada del servidor, aplicar la migración 061, desplegar el CRM y comprobar el envío real en un teléfono. `google-services.json` configura el cliente Android; por sí solo no autoriza al servidor a enviar avisos.

## Configuración de Firebase y Hostinger

1. Mantener la app Android registrada con el paquete `mx.drm.crm.preview` en el proyecto Firebase de DRM. Conservar `google-services.json` fuera de Git, en `android/app/` para compilar.
2. En Firebase, abrir **Configuración del proyecto → Cuentas de servicio → Firebase Admin SDK** y generar la clave privada de una cuenta de servicio del proyecto. Guardarla de forma privada. No introducirla en la APK, el repositorio, capturas ni chats.
3. En Hostinger, agregar la variable de servidor **`FCM_SERVICE_ACCOUNT_JSON`** con el JSON completo de esa credencial. Debe contener `project_id`, `client_email` y `private_key`; conservar los escapes `\n` de la clave. Para convertir el archivo a una línea, ejecutar localmente `node scripts/fcm-env.mjs ruta/al/archivo.json` y copiar su salida directamente al campo de Hostinger. Nunca usar un nombre `NEXT_PUBLIC_` para esa variable.
4. Verificar en el proyecto de Google Cloud/Firebase que **Firebase Cloud Messaging API (HTTP v1)** está habilitada y que la cuenta de servicio tiene permiso para enviar mensajes (rol Firebase Cloud Messaging API Admin, `roles/firebasecloudmessaging.admin`, o permisos equivalentes del proyecto).
5. En Supabase SQL Editor, fuente **Database**, aplicar íntegramente `supabase/migrations/061_android_push_devices.sql`. La migración es transaccional, admite reejecución y no cambia mensajes, contactos ni asignaciones existentes.
6. Desplegar la actualización del servidor únicamente después de la aprobación del propietario. El PR anterior de instalación PWA no es un requisito de esta integración Android.
7. Instalar la nueva APK firmada con la misma clave de prueba que 0.1.0, para actualizar la aplicación existente sin desinstalarla.

El resto del CRM sigue en Hostinger y Supabase. No se usa Firestore ni se necesitan credenciales de Meta nuevas para esta función.

## Activación y prueba real

1. Abrir la APK e iniciar sesión como agente. En **Configuración → Tu perfil**, localizar **Notificaciones en Android** y pulsar **Activar avisos**. Aceptar el permiso de Android cuando se solicite.
2. Asignar un chat al agente, salir de la aplicación y bloquear el teléfono. Enviar desde el destinatario autorizado de Meta un mensaje nuevo al número de prueba.
3. Confirmar sonido/aviso, tocarlo y verificar que abre el chat correcto. El aviso debe decir solamente que hay un mensaje nuevo, sin nombres ni contenido privado.
4. Probar un segundo agente: un chat asignado avisa únicamente al responsable. Un chat sin asignar avisa a los miembros owner/admin/agent con dispositivos activados. Viewers y miembros eliminados no reciben nuevos envíos del servidor.
5. Desactivar avisos y repetir; luego activarlos, cerrar sesión y repetir. El receptor nativo debe descartarlos inmediatamente al desactivar o salir, incluso si no pudo completar la baja en el servidor por falta de internet.
6. Probar otra cuenta en el mismo teléfono: requiere volver a activar los avisos; la asociación anterior se desactiva.
7. Repetir envío, foto, audio, teclado, navegación y reapertura del CRM para comprobar la mensajería habitual.

La app usa avisos de datos de prioridad alta de FCM y un servicio nativo que comprueba la activación local antes de mostrarlos. Android puede retrasar o impedir avisos por falta de internet, restricciones de batería, permisos denegados o **Forzar detención**. No garantiza entrega inmediata. La prueba con el teléfono bloqueado es necesaria antes de usarlo en operación.

## Comportamiento y privacidad

- El webhook guarda primero el mensaje y descarta reintentos duplicados; solo un primer ingreso genera avisos.
- Se vuelve a consultar la asignación y la membresía actuales antes del envío. El aviso contiene IDs internos y texto genérico, no nombres, teléfonos ni mensajes del cliente.
- El token FCM se cifra con el `ENCRYPTION_KEY` existente. La tabla tiene RLS y ningún permiso para `anon`/`authenticated`; solo el servidor puede acceder.
- La instalación tiene un UUID y secreto aleatorio de 256 bits. Se guarda únicamente el hash del secreto en Supabase. Una actualización del registro exige demostrar posesión del mismo secreto; usuario/cuenta se toman de la sesión del servidor, nunca del cuerpo enviado por el cliente.
- El puente de Android solo se expone al origen HTTPS exacto del CRM y rechaza subframes. No se agrega `addJavascriptInterface` ni se aceptan orígenes comodín.
- Los avisos llevan además la asociación cuenta/usuario: el receptor descarta avisos en cola de una sesión anterior aunque ese teléfono haya activado otra cuenta. Al salir o desactivar, se cierra primero el permiso lógico local, se borran avisos visibles y se solicita eliminar el token FCM. La baja del servidor queda limitada a instalación, secreto, usuario y cuenta actuales.
- Una instalación activa renueva el registro al abrir/retomar el CRM y cada cuatro horas mientras está abierta. Los registros vencen tras 14 días sin renovación. Si Firebase rota el token en segundo plano, se registra el nuevo al retomar la app; puede haber un intervalo sin avisos hasta entonces.
- Los avisos son de mejor esfuerzo: no se crea una cola de reintentos ni se reenvían mensajes de WhatsApp cuando falla Firebase. Un error de avisos no altera el mensaje recibido. La red de envío de avisos tiene un presupuesto acotado; los dispositivos `UNREGISTERED` se eliminan solo si su token no cambió mientras se enviaba.

## Compilar la APK de prueba

Usar JDK 21, Gradle 8.11.1, Android SDK Platform 35 y Build Tools compatibles. Colocar el archivo de cliente en `android/app/google-services.json` y definir `ANDROID_HOME` y `DRM_PREVIEW_KEYSTORE` con la ruta de la clave de prueba original conservada en el respaldo privado de la versión 0.1.0. Ejecutar:

```sh
gradle --no-daemon -p android :app:assembleRelease :app:lintRelease
```

La APK se genera en `android/app/build/outputs/apk/release/app-release.apk`. Es una versión de prueba 0.2.0, código 2, con el mismo paquete y certificado que 0.1.0. La clave de prueba no se publica en Git; una publicación definitiva requiere su propia estrategia de firma y distribución.

Referencias oficiales: [cliente FCM Android](https://firebase.google.com/docs/cloud-messaging/android/get-started), [envío HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api), [mensajes y prioridad](https://firebase.google.com/docs/cloud-messaging/android-message-priority), [puente con origen restringido](https://developer.android.com/reference/androidx/webkit/WebViewCompat).
