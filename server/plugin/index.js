(() => {
  const DEFAULT_CONFIG = {
    serverUrl: 'https://discordvideomod.onrender.com',
    updateUrl: 'https://discordvideomod.onrender.com/api/mod/mobile/update',
    version: '1.1.0-mobile',
    storageKey: '__DISCORD_MOD_MOBILE_BUNDLE__',
    storageMetaKey: '__DISCORD_MOD_MOBILE_META__'
  };

  let activeManager = null;

  return {
    onLoad: async () => {
      console.log('[DiscordVideoMod Plugin] Carregando plugin mobile...');
      const root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);

      // Tenta buscar o bundle atualizado via OTA
      try {
        const res = await fetch(`${DEFAULT_CONFIG.updateUrl}?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.code) {
            console.log(`[DiscordVideoMod Plugin] Executando bundle OTA v${data.version || '1.1.0-mobile'}`);
            const run = new Function('global', 'window', 'config', data.code);
            run(root, root, DEFAULT_CONFIG);
            activeManager = root.__DISCORD_MOBILE_MOD__?.manager;
            return;
          }
        }
      } catch (err) {
        console.warn('[DiscordVideoMod Plugin] Falha ao consultar OTA, tentando execução local:', err);
      }

      // Se offline ou falha no servidor, tenta ler do cache local
      try {
        const cached = root.localStorage?.getItem(DEFAULT_CONFIG.storageKey);
        if (cached) {
          const run = new Function('global', 'window', 'config', cached);
          run(root, root, DEFAULT_CONFIG);
          activeManager = root.__DISCORD_MOBILE_MOD__?.manager;
        }
      } catch (e) {}
    },

    onUnload: () => {
      console.log('[DiscordVideoMod Plugin] Descarregando plugin...');
      if (activeManager) {
        try {
          activeManager.stop();
        } catch (e) {}
        activeManager = null;
      }
      const root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global);
      if (root.__DISCORD_MOBILE_MOD__) {
        root.__DISCORD_MOBILE_MOD__.active = false;
      }
    }
  };
})();
