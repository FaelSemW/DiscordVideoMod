# 🚀 Discord Video Mod — Transmissão Nativa Sem Bloqueio & Sem Erro 2012

> **Cliente Discord Desktop com suporte nativo a transmissões de tela em 1080p 60 FPS no Brasil, eliminando o Erro 2012 através de pipeline próprio WebRTC com Atualização Automática.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-brightgreen.svg)]()
[![Open Source Love](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red.svg)]()
[![Security Audited](https://img.shields.io/badge/Security-100%25%20Transparent-success.svg)](SECURITY.md)

---

## 🎯 Por que este projeto existe?

No Brasil, os gateways oficiais de mídia do Discord foram afetados por restrições operacionais e de rede, resultando no bloqueio do botão *"Compartilhe sua tela"* e no infame **Erro 2012** (*"A transmissão não iniciou"*).

Este projeto é uma **modificação 100% open-source e transparente** para o Discord Desktop que:
1. **Neutraliza a trava regional** (`2026-08-video-guard`) e reabilita o botão nativo de Go Live.
2. **Desacopla a sinalização e o tráfego de vídeo** dos servidores oficiais da Discord Inc., roteando o streaming via WebRTC P2P através de um backend leve e de baixa latência (`zaprecovery.online` ou auto-hospedado).
3. **Mantém 100% da experiência oficial**: mesma grade de participantes, botões nativos, controle de volume individual, tela cheia e PiP.
4. **Atualizações Automáticas (Auto-Updater)**: sempre que correções de bugs ou melhorias são lançadas no servidor, os clientes instalados recebem o código novo automaticamente sem que ninguém precise reinstalar ou baixar novos arquivos!

---

## 🏗️ Arquitetura

```text
[Transmissor (Você)] ────(Captura Nativa 1080p60)────► [Servidor de Sinalização]
                                                               │
[Espectador (Amigo)] ◄───(Injeta na tag <video> Nativa)────────┘
      (Zero consulta à API oficial de mídia do Discord / Zero Erro 2012)
```

1. **Quem transmite**: Clica no botão oficial de transmissão do Discord. O mod captura o monitor ou jogo a 60 FPS com áudio do sistema e anuncia a oferta no servidor de sinalização associada ao canal de voz.
2. **Quem assiste**: O mod recebe a notificação da transmissão no canal e vincula o stream remoto diretamente na tag `<video>` do participante na grade da chamada.
3. **Mídia P2P**: Os pacotes de vídeo trafegam de forma direta (WebRTC) com taxas de bitrate configuradas para até 10 Mbps (ultra nitidez).

---

## 📦 Instalação (1 Clique)

Você pode escolher a opção mais prática para você:

### 🌟 Opção 1: Instalador Oficial Tudo-em-Um (`DiscordModSetup.exe`)
* **Recomendado para quem quer tudo pronto em 1 arquivo executável.**
* Encerra instâncias antigas do Discord.
* Instala o Discord com o mod pré-configurado em `%LOCALAPPDATA%\DiscordMod`.
* Cria atalhos oficiais na **Área de Trabalho** e no **Menu Iniciar** com o ícone do Discord.
* Inicia o Discord automaticamente após a instalação.

### ⚡ Opção 2: Injetor Leve (`DiscordModInjector.exe`)
* **Apenas ~600 KB!** Ideal para enviar para amigos pelo chat ou WhatsApp.
* Injeta o mod no Discord oficial que o amigo já tiver instalado em menos de 1 segundo sem precisar baixar mais nada.

---

## 🔄 Sistema de Atualização Automática (Auto-Updater)

O mod possui um sistema de atualização transparente:
* Ao iniciar o Discord, o mod consulta o endpoint seguro `/api/mod/update` do servidor.
* Se houver uma nova versão no servidor com correções de bugs ou melhorias nos scripts de injeção (`renderer.js`, `webrtcService.js` ou `main.cjs`), o cliente baixa e aplica silenciosamente no `%LOCALAPPDATA%`.
* Você e seus amigos ficam sempre na versão mais recente sem intervenção manual!

---

## 🛡️ Segurança e Código Aberto

Tudo neste projeto é **público, auditável e sem telemetria**:
* 🟢 **Zero Token Stealers**: O mod não acessa nem transmite tokens, credenciais ou mensagens privadas.
* 🟢 **Zero Vírus / Trojans**: Todo o código fonte em C# dos instaladores e em JavaScript do mod está disponível neste repositório para inspeção.
* 🟢 Consulte nosso guia de auditoria detalhado em [SECURITY.md](SECURITY.md).

---

## 💻 Como Compilar a partir do Código Fonte

### Pré-requisitos
* Windows 10/11 x64
* Node.js 18+ (opcional para rodar o backend local)
* O compilador C# (`csc.exe`) já vem instalado nativamente em qualquer Windows em `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`.

### Compilar os instaladores:
Abra o PowerShell na pasta do repositório e execute:
```powershell
cd installer
.\build-installer.ps1
```
Os executáveis prontos serão gerados na pasta `dist/`.

---

## 🌐 Como Rodar o Próprio Servidor de Sinalização

Se preferir não usar o servidor público padrão (`zaprecovery.online`), você pode rodar sua própria instância do backend:

```bash
cd server
npm install
npm start
```

No arquivo `mod/renderer.js` e `mod/webrtcService.js`, basta alterar a constante `ZAP_SIGNALING` para a URL do seu servidor (ex: `wss://seu-dominio.com/signaling`).

---

## 📱 Roadmap Mobile

- [x] **Windows Desktop**: Instalador único .exe, injeção Electron, WebRTC 1080p60, bypass do Erro 2012 e Auto-Updater.
- [ ] **Android (APK)**: Mod do cliente móvel Discord com WebView WebRTC e suporte a modo PiP (Picture-in-Picture).
- [ ] **iOS (IPA)**: Pacote sideloadable via AltStore / TrollStore / Sideloadly com suporte ao reprodutor Safari WebRTC.

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
