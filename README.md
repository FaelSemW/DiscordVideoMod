# ðŸš€ Discord Video Mod â€” TransmissÃ£o Nativa Sem Bloqueio & Sem Erro 2012

> **Cliente Discord Desktop com suporte nativo a transmissÃµes de tela em 1080p 60 FPS no Brasil, eliminando o Erro 2012 atravÃ©s de pipeline prÃ³prio WebRTC com AtualizaÃ§Ã£o AutomÃ¡tica.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-brightgreen.svg)]()
[![Open Source Love](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red.svg)]()
[![Security Audited](https://img.shields.io/badge/Security-100%25%20Transparent-success.svg)](SECURITY.md)

---

## ðŸŽ¯ Por que este projeto existe?

No Brasil, os gateways oficiais de mÃ­dia do Discord foram afetados por restriÃ§Ãµes operacionais e de rede, resultando no bloqueio do botÃ£o *"Compartilhe sua tela"* e no infame **Erro 2012** (*"A transmissÃ£o nÃ£o iniciou"*).

Este projeto Ã© uma **modificaÃ§Ã£o 100% open-source e transparente** para o Discord Desktop que:
1. **Neutraliza a trava regional** (`2026-08-video-guard`) e reabilita o botÃ£o nativo de Go Live.
2. **Desacopla a sinalizaÃ§Ã£o e o trÃ¡fego de vÃ­deo** dos servidores oficiais da Discord Inc., roteando o streaming via WebRTC P2P atravÃ©s de um backend leve e de baixa latÃªncia (`zaprecovery.online` ou auto-hospedado).
3. **MantÃ©m 100% da experiÃªncia oficial**: mesma grade de participantes, botÃµes nativos, controle de volume individual, tela cheia e PiP.
4. **AtualizaÃ§Ãµes AutomÃ¡ticas (Auto-Updater)**: sempre que correÃ§Ãµes de bugs ou melhorias sÃ£o lanÃ§adas no servidor, os clientes instalados recebem o cÃ³digo novo automaticamente sem que ninguÃ©m precise reinstalar ou baixar novos arquivos!

---

## ðŸ—ï¸ Arquitetura

```text
[Transmissor (VocÃª)] â”€â”€â”€â”€(Captura Nativa 1080p60)â”€â”€â”€â”€â–º [Servidor de SinalizaÃ§Ã£o]
                                                               â”‚
[Espectador (Amigo)] â—„â”€â”€â”€(Injeta na tag <video> Nativa)â”€â”€â”€â”€â”€â”€â”€â”€â”˜
      (Zero consulta Ã  API oficial de mÃ­dia do Discord / Zero Erro 2012)
```

1. **Quem transmite**: Clica no botÃ£o oficial de transmissÃ£o do Discord. O mod captura o monitor ou jogo a 60 FPS com Ã¡udio do sistema e anuncia a oferta no servidor de sinalizaÃ§Ã£o associada ao canal de voz.
2. **Quem assiste**: O mod recebe a notificaÃ§Ã£o da transmissÃ£o no canal e vincula o stream remoto diretamente na tag `<video>` do participante na grade da chamada.
3. **MÃ­dia P2P**: Os pacotes de vÃ­deo trafegam de forma direta (WebRTC) com taxas de bitrate configuradas para atÃ© 10 Mbps (ultra nitidez).

---

## ðŸ“¦ InstalaÃ§Ã£o (1 Clique)

VocÃª pode escolher a opÃ§Ã£o mais prÃ¡tica para vocÃª:

### ðŸŒŸ OpÃ§Ã£o 1: Instalador Oficial Tudo-em-Um (`DiscordModSetup.exe`)
* **Recomendado para quem quer tudo pronto em 1 arquivo executÃ¡vel.**
* Encerra instÃ¢ncias antigas do Discord.
* Instala o Discord com o mod prÃ©-configurado em `%LOCALAPPDATA%\DiscordMod`.
* Cria atalhos oficiais na **Ãrea de Trabalho** e no **Menu Iniciar** com o Ã­cone do Discord.
* Inicia o Discord automaticamente apÃ³s a instalaÃ§Ã£o.

### âš¡ OpÃ§Ã£o 2: Injetor Leve (`DiscordModInjector.exe`)
* **Apenas ~600 KB!** Ideal para enviar para amigos pelo chat ou WhatsApp.
* Injeta o mod no Discord oficial que o amigo jÃ¡ tiver instalado em menos de 1 segundo sem precisar baixar mais nada.

---

## ðŸ”„ Sistema de AtualizaÃ§Ã£o AutomÃ¡tica (Auto-Updater)

O mod possui um sistema de atualizaÃ§Ã£o transparente:
* Ao iniciar o Discord, o mod consulta o endpoint seguro `/api/mod/update` do servidor.
* Se houver uma nova versÃ£o no servidor com correÃ§Ãµes de bugs ou melhorias nos scripts de injeÃ§Ã£o (`renderer.js`, `webrtcService.js` ou `main.cjs`), o cliente baixa e aplica silenciosamente no `%LOCALAPPDATA%`.
* VocÃª e seus amigos ficam sempre na versÃ£o mais recente sem intervenÃ§Ã£o manual!

---

## ðŸ›¡ï¸ SeguranÃ§a e CÃ³digo Aberto

Tudo neste projeto Ã© **pÃºblico, auditÃ¡vel e sem telemetria**:
* ðŸŸ¢ **Zero Token Stealers**: O mod nÃ£o acessa nem transmite tokens, credenciais ou mensagens privadas.
* ðŸŸ¢ **Zero VÃ­rus / Trojans**: Todo o cÃ³digo fonte em C# dos instaladores e em JavaScript do mod estÃ¡ disponÃ­vel neste repositÃ³rio para inspeÃ§Ã£o.
* ðŸŸ¢ Consulte nosso guia de auditoria detalhado em [SECURITY.md](SECURITY.md).

---

## ðŸ’» Como Compilar a partir do CÃ³digo Fonte

### PrÃ©-requisitos
* Windows 10/11 x64
* Node.js 18+ (opcional para rodar o backend local)
* O compilador C# (`csc.exe`) jÃ¡ vem instalado nativamente em qualquer Windows em `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`.

### Compilar os instaladores:
Abra o PowerShell na pasta do repositÃ³rio e execute:
```powershell
cd installer
.\build-installer.ps1
```
Os executÃ¡veis prontos serÃ£o gerados na pasta `dist/`.

---

## ðŸŒ Como Rodar o PrÃ³prio Servidor de SinalizaÃ§Ã£o

Se preferir nÃ£o usar o servidor pÃºblico padrÃ£o (`zaprecovery.online`), vocÃª pode rodar sua prÃ³pria instÃ¢ncia do backend:

```bash
cd server
npm install
npm start
```

No arquivo `mod/renderer.js` e `mod/webrtcService.js`, basta alterar a constante `ZAP_SIGNALING` para a URL do seu servidor (ex: `wss://seu-dominio.com/signaling`).

---

## ðŸ“± Roadmap Mobile

- [x] **Windows Desktop**: Instalador Ãºnico .exe, injeÃ§Ã£o Electron, WebRTC 1080p60, bypass do Erro 2012 e Auto-Updater.
- [ ] **Android (APK)**: Mod do cliente mÃ³vel Discord com WebView WebRTC e suporte a modo PiP (Picture-in-Picture).
- [ ] **iOS (IPA)**: Pacote sideloadable via AltStore / TrollStore / Sideloadly com suporte ao reprodutor Safari WebRTC.

---

## ðŸ“„ LicenÃ§a

DistribuÃ­do sob a licenÃ§a [MIT](LICENSE).
