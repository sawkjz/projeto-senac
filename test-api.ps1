#!/usr/bin/env pwsh

Write-Host ""
Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Teste de Conectividade da API         ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$API_URL = "http://localhost:3001"

Write-Host "1. Testando /health..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod "$API_URL/health"
    Write-Host ($response | ConvertTo-Json) -ForegroundColor Green
} catch {
    Write-Host "FALHOU: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "2. Testando /debug/config (desenvolvimento)..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod "$API_URL/debug/config"
    Write-Host ($response | ConvertTo-Json) -ForegroundColor Green
} catch {
    Write-Host "FALHOU: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "3. Testando /bootstrap..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod "$API_URL/bootstrap"
    Write-Host "Status: OK" -ForegroundColor Green
    Write-Host "Cursos: $($response.courses.count)" -ForegroundColor Green
    Write-Host "Equipes: $($response.teams.count)" -ForegroundColor Green
    Write-Host "Critérios: $($response.criteria.count)" -ForegroundColor Green
} catch {
    Write-Host "FALHOU: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "4. Testando /jurors/status..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod "$API_URL/jurors/status"
    Write-Host ($response | ConvertTo-Json) -ForegroundColor Green
} catch {
    Write-Host "FALHOU: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "5. Testando /ranking..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod "$API_URL/ranking"
    Write-Host "Status: OK" -ForegroundColor Green
    Write-Host "Equipes no ranking: $($response.count)" -ForegroundColor Green
} catch {
    Write-Host "FALHOU: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "✓ Testes concluídos" -ForegroundColor Green
Write-Host ""
