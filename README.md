# Discord Video Mod

Mod experimental para Windows que captura uma tela ou janela e transmite por WebRTC próprio. A versão 1.0.8 usa controles e player do mod dentro da janela do Discord, sem iniciar o Go Live oficial por esse caminho.

## Instalação e uso

1. Instale `DiscordModSetup.exe` da release mais recente nos dois computadores. Quem já usa o mod recebe os scripts pelo atualizador; encerre completamente e reabra o Discord após a atualização.
2. Ambos entram no mesmo canal de voz.
3. Quem transmite clica em **Transmitir / parar pelo site**, escolhe qualidade e uma tela ou janela na lista. O preview deve mostrar a imagem escolhida.
4. Quem assiste clica em **Assistir pelo site**. Também há inscrição automática ao entrar no canal.
5. Use os controles do vídeo para áudio e tela cheia. **Fechar / parar transmissão** encerra a captura local ou fecha a recepção.

O botão de compartilhar tela conhecido é interceptado; botões e atalhos de versões diferentes do Discord podem mudar. Para testar o caminho independente, use os botões do mod. Os controles oficiais de transmissão não gerenciam essa sessão. Voz, login e canais continuam sendo recursos do Discord.

## Arquitetura e limites

- `wss://zaprecovery.online/signaling`: sinalização, ofertas, respostas e candidatos ICE.
- O vídeo e o áudio seguem diretamente entre os computadores por WebRTC. O servidor HTTP não retransmite os quadros de vídeo.
- A configuração de STUN/TURN é lida de `/api/ice` pelo processo Electron. Um servidor TURN precisa existir e estar configurado para oferecer retransmissão quando a rede impedir conexão direta. Em 22/10/2026, o endpoint público retornou somente STUN.
- Uma transmissão por canal é suportada pelo backend atual. Transmissões simultâneas no mesmo canal ainda não são suportadas.
- Resolução e FPS são preferências; a captura e a rede podem entregar menos. Áudio do sistema depende do Electron/Windows; falhas geram aviso e tentativa de vídeo sem áudio.
- Não há garantia de eliminação de toda tela preta. Captura real e áudio entre dois computadores ainda precisam de validação dos usuários. Os testes automatizados usam simulações de captura/RTC e um servidor WebSocket real para sinalização.

## Correções 1.0.8

- Seleção explícita usando IDs reais de fontes Electron, sem escolher outro monitor silenciosamente.
- Início independente de eventos do Go Live oficial; remoção do código que escondia erros e spinners globais do Discord.
- Player próprio estável, com aviso de autoplay e diagnóstico de conexão sem quadros decodificados.
- Evita destruir uma negociação ainda em andamento ao receber inscrição duplicada.
- Timeout de conexão e mensagens distintas para captura, conexão e reprodução; limpeza dos timers ao encerrar.
- Uso da configuração de ICE existente no backend, sem registrar credenciais nos logs.

## Código e testes

`mod/main.cjs` injeta os scripts e integra a captura Electron; `mod/renderer.js` contém interface e integração de canal; `mod/webrtcService.js` contém captura e WebRTC; `server/signaling.js` é o backend independente.

Com Node.js e `ws` disponível:

```powershell
node --test mod/webrtc.test.cjs mod/renderer.test.cjs server/signaling.test.cjs
node mod/test.cjs
```

Logs ficam em `runtime/video-mod.jsonl` da instalação. No instalador completo: `%LOCALAPPDATA%\DiscordMod\runtime\video-mod.jsonl`. O campo `verified` verifica somente o override do experimento, não a transmissão.

Para compilar os instaladores no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File installer/build-installer.ps1 -ClientDir C:\caminho\client
```

Consulte [CHANGELOG.md](CHANGELOG.md) para o histórico e [LICENSE](LICENSE) para a licença.
