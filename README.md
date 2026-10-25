# 🚀 Discord Video Mod — Transmissão Nativa Sem Bloqueio & Sem Erro 2012

> **Cliente Discord Desktop com suporte nativo a transmissões de tela em 1080p 60 FPS no Brasil, eliminando o Erro 2012 através de pipeline próprio WebRTC P2P e Auto-Updater.**

[![Release: v1.1.3](https://img.shields.io/badge/Release-v1.1.3%20Est%C3%A1vel-brightgreen?style=for-the-badge)](https://github.com/FaelSemW/DiscordVideoMod/releases/tag/v1.1.3)
[![Download Injetor](https://img.shields.io/badge/Download-DiscordModInjector.exe%20(624%20KB)-blue?style=for-the-badge&logo=windows)](https://github.com/FaelSemW/DiscordVideoMod/releases/download/v1.1.3/DiscordModInjector.exe)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-brightgreen.svg)]()

---

## ⚡ Download Rápido (Versão Estável v1.1.3)

| Arquivo | Tamanho | Descrição | Link Direto |
| :--- | :--- | :--- | :--- |
| **`DiscordModInjector.exe`** | **~624 KB** | **Recomendado para amigos!** Injeta o mod no Discord oficial em menos de 1 segundo. | [**👉 Baixar Injetor (624 KB)**](https://github.com/FaelSemW/DiscordVideoMod/releases/download/v1.1.3/DiscordModInjector.exe) |
| **`DiscordLauncher.exe`** | ~292 KB | Inicializador silencioso do cliente modificado. | [**Baixar Launcher**](https://github.com/FaelSemW/DiscordVideoMod/releases/download/v1.1.3/DiscordLauncher.exe) |

---

## 🎯 Como Usar (Você e seus Amigos)

Para que a transmissão funcione via P2P livre dos bloqueios regionais do Discord no Brasil, **quem transmite e quem assiste devem ter o mod instalado**:

1. **Baixe o [DiscordModInjector.exe](https://github.com/FaelSemW/DiscordVideoMod/releases/download/v1.1.3/DiscordModInjector.exe)** (apenas ~600 KB).
2. **Execute o arquivo** com o Discord aberto ou fechado (a injeção é automática e instantânea).
3. **Abra o Discord** e entre no canal de voz.
4. Clique em **"Compartilhar sua tela"** (pode escolher a tela inteira ou uma aplicação/janela de jogo específica).
5. Seus amigos que também tiverem o mod verão a live em tempo real a 60 FPS com áudio do sistema, sem travar e sem Erro 2012!

---

## 🛠️ Novidades da Versão 1.1.3

- **Transmissão de Janelas de Jogos:** Corrigido o carregamento infinito ao selecionar janelas individuais (como Roblox, navegadores ou outros jogos).
- **Imunização Permanente de Mídias do Chat:** A transmissão nunca mais vaza para GIFs, emojis animados ou vídeos do bate-papo.
- **Reconexão Rápida sem Tela Preta:** Ao sair e voltar da live, a visualização conecta instantaneamente.
- **Detecção Robusta de Canais:** Identificação precisa do canal de voz ativo e roteamento direto das ofertas de vídeo.

---

## 🏗️ Arquitetura

```text
[Transmissor (Você)] ────(Captura 1080p60 WebRTC)────► [Sinalização Render Cloud]
                                                              │
[Espectador (Amigo)] ◄───(Injeta no Player Nativo)────────────┘
      (Zero tráfego nos gateways bloqueados / Zero Erro 2012)
```

1. **Captura Nativa**: Captura a tela ou janela do jogo a 60 FPS com áudio do sistema.
2. **Sinalização WebRTC**: Estabelece conexão P2P de alta taxa de dados (Mesh) diretamente entre os computadores na chamada.
3. **Interface 100% Original**: Utiliza o layout original do Discord, controles de volume, tela cheia e modo picture-in-picture.
4. **Auto-Updater Silencioso**: Toda melhoria publicada no servidor é atualizada automaticamente em segundo plano.

---

## 🛡️ Segurança e Código Aberto

Tudo neste projeto é **100% público, auditável e sem telemetria**:
* 🟢 **Zero Token Stealers**: O mod não lê e não envia seus dados ou tokens do Discord.
* 🟢 **Zero Vírus / Cavalos de Troia**: Código-fonte C# e JavaScript disponível para inspeção.
* 🟢 Consulte nosso guia de auditoria detalhado em [SECURITY.md](SECURITY.md).

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
