# Discord Video Mod

Mod experimental para usar a interface de transmissão do Discord com sinalização e WebRTC próprios. A versão 1.0.9 substitui a interface separada da 1.0.8 por um adaptador dos controles nativos.

## Instalação e uso

1. Atualize os dois computadores com `DiscordModSetup.exe` da release mais recente. Encerre completamente e reabra os dois clientes após atualizar.
2. Entrem no mesmo canal de voz.
3. Use **Compartilhar sua tela** do próprio Discord e escolha a fonte, qualidade e áudio no seletor original.
4. A outra pessoa usa a transmissão exibida na chamada do Discord. O mod entrega o MediaStream ao componente de vídeo nativo, preservando o restante da interface.
5. Use os controles originais para qualidade, volume e encerramento. Não é necessário abrir o site.

Não há botão flutuante, seletor paralelo ou player separado. Caso o adaptador não encontre os componentes esperados, o botão de compartilhar mostra uma mensagem de incompatibilidade, sem abrir outra interface.

## O papel do backend

`wss://zaprecovery.online/signaling` negocia a sessão própria: ofertas, respostas e candidatos ICE. O site não fornece permissões aos servidores oficiais do Discord. O mod substitui as ações de conexão da transmissão no cliente.

O áudio e o vídeo usam WebRTC direto entre os computadores. `/api/ice` fornece STUN/TURN; em 22/10/2026, o endpoint público ainda fornece somente STUN. Um servidor TURN operacional é necessário para retransmitir a mídia quando a rede impedir conexão direta. O túnel HTTP do site não realiza essa retransmissão.

Login, canais e voz normal continuam no Discord. Ambos os participantes precisam do mod. O backend atual suporta uma transmissão por canal.

## Integração 1.0.9

- Lê a fonte em `settings.desktopSettings.sourceId`, a qualidade em `settings.qualityOptions` e a opção de áudio do seletor original.
- Aguarda tanto a seleção quanto `STREAM_START` antes de capturar.
- Substitui somente as ações de transmissão de `GatewayConnectionStore` e `StreamRTCConnectionStore`; preserva as ações de voz.
- Publica metadados locais para `ApplicationStreamingStore` e `VideoStreamStore`, sem falsificar atualizações de estado de voz.
- Adapta `MediaEngineStore.getVideoComponent()` para entregar a mídia própria à área de vídeo original. As câmeras continuam com o componente original.
- Liga qualidade, áudio e encerramento aos controles nativos. Fechar a recepção mantém a transmissão disponível para assistir novamente.

O adaptador foi mapeado a partir do JavaScript público do Discord disponível em 22/10/2026. Esses detalhes internos podem mudar. Os testes automatizados verificam o contrato e a sinalização; não substituem uma chamada real entre os dois computadores. Compatibilidade visual, popout e todos os controles nativos ainda não foram validados em uso real. Não há garantia de resolução universal de tela preta.

## Desenvolvimento

`mod/main.cjs`: injeção e captura Electron; `mod/renderer.js`: adaptação nativa; `mod/webrtcService.js`: captura e transporte WebRTC; `server/signaling.js`: backend independente.

Com Node.js e `ws` disponível:

```powershell
node --test mod/webrtc.test.cjs mod/renderer.test.cjs server/signaling.test.cjs
node mod/test.cjs
```

Logs: `%LOCALAPPDATA%\DiscordMod\runtime\video-mod.jsonl`. `integration.nativeAdapter` indica que os componentes foram encontrados e adaptados. `verified` indica apenas o override do experimento; nenhum deles comprova vídeo recebido.

Compilação no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File installer/build-installer.ps1 -ClientDir C:\caminho\client
```

Consulte [CHANGELOG.md](CHANGELOG.md) e [LICENSE](LICENSE).
