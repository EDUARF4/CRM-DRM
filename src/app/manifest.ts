import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'DRM CRM',
    short_name: 'DRM CRM',
    description: 'Bandeja de atención y clientes de DRM.',
    lang: 'es-MX',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    background_color: '#101114',
    theme_color: '#101114',
    icons: [
      { src: '/app-icons/drm-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icons/drm-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icons/drm-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
