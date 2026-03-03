# AgendeZap - Deploy Edge Function 24/7
# Execute: clique direito, "Executar com PowerShell"

$EXE = "C:\Users\mathe\AppData\Local\npm-cache\_npx\aa8e5c70f9d8d161\node_modules\supabase\bin\supabase.exe"
$PROJECT = "cnnfnqrnjckntnxdgwae"
$WORKDIR = "C:\Users\mathe\OneDrive\Desktop\AgendeZap\AgendeZap"

Set-Location $WORKDIR

Write-Host ""
Write-Host "=== AgendeZap - Deploy Edge Function ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Passo 1: Login no Supabase (vai abrir o navegador)..." -ForegroundColor Yellow

& $EXE login

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO no login. Abortando." -ForegroundColor Red
    Read-Host "Enter para fechar"
    exit 1
}

Write-Host ""
Write-Host "Passo 2: Vinculando ao projeto..." -ForegroundColor Yellow

& $EXE link --project-ref $PROJECT

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO ao vincular projeto." -ForegroundColor Red
    Read-Host "Enter para fechar"
    exit 1
}

Write-Host ""
Write-Host "Passo 3: Deploy da Edge Function..." -ForegroundColor Yellow

& $EXE functions deploy whatsapp-webhook --no-verify-jwt

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Deploy concluido com sucesso!" -ForegroundColor Green
    Write-Host "URL: https://$PROJECT.supabase.co/functions/v1/whatsapp-webhook" -ForegroundColor Cyan
} else {
    Write-Host "ERRO no deploy." -ForegroundColor Red
}

Write-Host ""
Read-Host "Enter para fechar"
