# 1.0.5 — correções de transmissão

- Remove a regra CSS que escondia o ancestral do player ao encontrar um aviso de transmissão pausada.
- Usa um único player de áudio/vídeo, sem sobrescrever câmeras e todos os vídeos da interface. Mantém volume escolhido durante atualizações do DOM.
- Encaminha o identificador de tela/janela escolhido para o capturador Electron quando disponível.
- Serializa mensagens de sinalização e deduplica início simultâneo de captura.
- Usa oferta dedicada por espectador; protocolo 2 também atende espectadores inscritos antes do transmissor.
- Enfileira candidatos ICE recebidos antes da descrição remota. Preserva o SDP gerado pelo Chromium.
- Cancela captura pendente ao parar; ignora mensagens de outro canal; saída do espectador não anuncia fim da transmissão.
- Atualizações passam a exigir reinício, mantendo uma geração coerente dos scripts em execução.

## Aplicação

1. Atualize e reinicie o backend de sinalização antes de distribuir o cliente 1.0.5. O arquivo deste repositório é `server/signaling.js`; backends integrados precisam implementar `stream:viewer-joined`, `stream:offer` e `protocolVersion: 2`.
2. Distribua juntos `main.cjs`, `renderer.js`, `webrtcService.js` e `config.json` de `mod/`. Reinicie completamente o Discord de transmissor e espectadores.
3. Valide em dois computadores: monitor, janela, áudio, parar/reiniciar, espectador entrando antes/depois, dois espectadores e reconexão.

## Verificação e limites

Execute `npm install` e `npm test` dentro de `server/`. Há testes de negociação com WebSockets reais, ciclo de captura com objetos simulados e o teste de overrides do renderer.

Não foi validada uma chamada real entre duas contas. O player integrado dispõe de controles HTML de volume, tela cheia e recursos do navegador; equivalência completa com os controles internos do Discord não está implementada. O backend coordena WebRTC P2P, não substitui o banco de permissões oficial. A configuração padrão tem STUN, sem TURN: conectividade entre todas as redes não está garantida. Os executáveis antigos não foram recompilados nesta atualização.
