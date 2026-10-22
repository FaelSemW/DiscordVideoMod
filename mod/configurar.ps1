param([ValidateSet('ativar','desativar')][string]$Acao)
if (!$Acao) { throw 'Use ativar ou desativar.' }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'config.json'), (@{enabled=($Acao -eq 'ativar')} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Host 'Configuracao salva. Feche esta copia do Discord pela bandeja e abra novamente pelo launcher.'
