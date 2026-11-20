'use client';

import { useState } from 'react';
import { Download, Smartphone, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { usePwa } from './pwa-provider';

export function InstallCard() {
  const t = useTranslations('Pwa');
  const { installed, canPrompt, install } = usePwa();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const handleInstall = async () => {
    setBusy(true); setFailed(false);
    try { await install(); } catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="drm-install-title">
      <div className="flex items-start gap-3">
        {installed ? <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          : <Smartphone className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <h2 id="drm-install-title" className="font-semibold">{installed ? t('installedTitle') : t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{installed ? t('installedDescription') : t('description')}</p>
          {!installed && <>
            {canPrompt && <Button className="mt-4" onClick={handleInstall} disabled={busy}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />{busy ? t('opening') : t('install')}
            </Button>}
            {(!canPrompt || failed) && <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              {failed && <p role="alert">{t('failed')}</p>}
              <p>{t('androidHelp')}</p>
              <p>{t('iosHelp')}</p>
            </div>}
            <p className="mt-3 text-xs text-muted-foreground">{t('connectionRequired')}</p>
          </>}
        </div>
      </div>
    </section>
  );
}
