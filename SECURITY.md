# Política de Segurança & Auditoria Aberta

Este projeto foi desenvolvido com **100% de transparência e código aberto**, visando exclusivamente contornar as restrições regionais de transmissão de tela no Brasil e eliminar o Erro 2012 através de um pipeline direto WebRTC.

---

### 🛡️ Garantias de Segurança (O que este software NÃO faz):

1. **Zero Captura de Credenciais ou Tokens**:
   - O código não lê, não intercepta e não envia tokens do Discord (`token`, `localStorage`, `sessionStorage`, `cookies`).
   - Você pode auditar todo o código fonte em [`mod/renderer.js`](mod/renderer.js), [`mod/main.cjs`](mod/main.cjs) e [`installer/Program.cs`](installer/Program.cs).

2. **Zero Telemetria Oculta ou Adware**:
   - Não há scripts analíticos de terceiros, rastreadores de anúncios ou mineradores.
   - O único tráfego de rede gerado pelo mod é a sinalização WebRTC necessária para conectar quem transmite com quem assiste na chamada.

3. **Comunicação WebRTC Direta e Criptografada**:
   - O áudio e vídeo trafegam ponto a ponto (P2P) com criptografia DTLS-SRTP padrão da especificação WebRTC.
   - Apenas os usuários que estão no mesmo canal de voz trocam ofertas e respostas de vídeo.

---

### 🔍 Como auditar o código antes de usar:

Qualquer desenvolvedor ou usuário pode inspecionar e compilar o projeto do zero:

1. **Inspecione a Injeção Electron**:
   Abra [`mod/main.cjs`](mod/main.cjs) e veja como o hook é acoplado apenas ao ciclo de vida da janela.
2. **Inspecione a Mídia e Dispatcher**:
   Abra [`mod/renderer.js`](mod/renderer.js) e [`mod/webrtcService.js`](mod/webrtcService.js) e veja a troca de sinalização WebRTC.
3. **Compile os instaladores você mesmo**:
   O instalador é código C# puro sem bibliotecas externas pré-compiladas. Você pode inspecionar [`installer/Program.cs`](installer/Program.cs) e compilar diretamente no Windows usando o script [`installer/build-installer.ps1`](installer/build-installer.ps1).
