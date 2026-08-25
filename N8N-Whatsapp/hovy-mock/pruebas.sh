#!/usr/bin/env bash
# Bateria de pruebas del spike. Correr desde Git Bash (en PowerShell, `curl` es
# un alias de Invoke-WebRequest y no acepta estos flags).
#
#   ./pruebas.sh          -> capa 1 (mock) + capa 2 (workflow de n8n)
#   ./pruebas.sh mock     -> solo el mock, sin necesitar n8n levantado

set -u

API="${API:-http://localhost:3000/api/bot}"
BOT="${BOT:-http://localhost:5678/webhook/hovy-bot}"
KEY="X-API-Key: hovy-dev-key"
JSON="Content-Type: application/json"

pasaron=0
fallaron=0

verde()   { printf '\033[32m%s\033[0m' "$1"; }
rojo()    { printf '\033[31m%s\033[0m' "$1"; }
titulo()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

resultado() { # <ok|no> <descripcion> <detalle>
  if [ "$1" = "ok" ]; then
    pasaron=$((pasaron + 1)); printf '  %s %s\n' "$(verde PASA)" "$2"
  else
    fallaron=$((fallaron + 1)); printf '  %s %s\n       %s\n' "$(rojo FALLA)" "$2" "$3"
  fi
}

reset_datos() { curl -s -o /dev/null -H "$KEY" -X POST "$API/_debug/reset"; }

# --- Capa 1: el mock solo -----------------------------------------------------
# api <descripcion> <status esperado> <metodo> <ruta> [body]
api() {
  local desc="$1" esperado="$2" metodo="$3" ruta="$4" body="${5:-}"
  local resp status
  if [ -n "$body" ]; then
    resp=$(curl -s -w $'\n%{http_code}' -X "$metodo" "$API$ruta" -H "$KEY" -H "$JSON" -d "$body")
  else
    resp=$(curl -s -w $'\n%{http_code}' -X "$metodo" "$API$ruta" -H "$KEY")
  fi
  status="${resp##*$'\n'}"
  if [ "$status" = "$esperado" ]; then
    resultado ok "$desc"
  else
    resultado no "$desc" "esperaba $esperado, vino $status -> ${resp%$'\n'*}"
  fi
}

capa_mock() {
  titulo "Capa 1 - Backend mock ($API)"
  reset_datos

  api "cliente registrado devuelve 200"            200 GET  "/cliente?telefono=5493511111111"
  api "cliente no registrado devuelve 404"         404 GET  "/cliente?telefono=5493519999999"
  api "proximo turno de Juan devuelve 200"         200 GET  "/turnos/proximo?clienteId=1"
  api "Juan confirma su turno 142"                 200 POST "/turnos/142/confirmar" '{"clienteId":1}'
  api "Juan NO puede tocar el 143 de Ana"          403 POST "/turnos/143/confirmar" '{"clienteId":1}'
  api "turno inexistente devuelve 404"             404 POST "/turnos/999/confirmar" '{"clienteId":1}'
  api "Juan responde la encuesta del 144"          201 POST "/encuestas" '{"clienteId":1,"puntaje":5}'
  api "no puede responderla dos veces"             409 POST "/encuestas" '{"clienteId":1,"puntaje":4}'
  api "Ana no tiene servicios realizados"          409 POST "/encuestas" '{"clienteId":2,"puntaje":3}'
  api "puntaje fuera de rango devuelve 400"        400 POST "/encuestas" '{"clienteId":1,"puntaje":9}'
  api "Juan rechaza su turno 142"                  200 POST "/turnos/142/rechazar" '{"clienteId":1}'
  api "sin turnos pendientes devuelve 404"         404 GET  "/turnos/proximo?clienteId=1"

  # La API key va aparte porque `api` siempre la manda.
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' "$API/cliente?telefono=5493511111111")
  if [ "$status" = "401" ]; then
    resultado ok "sin X-API-Key devuelve 401"
  else
    resultado no "sin X-API-Key devuelve 401" "esperaba 401, vino $status"
  fi
}

# --- Capa 2: el workflow completo --------------------------------------------
# bot <descripcion> <fragmento esperado en la respuesta, o "" si debe ser vacia> <payload>
bot() {
  local desc="$1" contiene="$2" payload="$3"
  local resp status body
  resp=$(curl -s -w $'\n%{http_code}' -X POST "$BOT" -H "$JSON" -d "$payload")
  status="${resp##*$'\n'}"
  body="${resp%$'\n'*}"

  if [ "$status" != "200" ]; then
    resultado no "$desc" "esperaba status 200, vino $status -> $body"
  elif [ -z "$contiene" ] && [ -n "$body" ]; then
    resultado no "$desc" "esperaba respuesta VACIA, vino -> $body"
  elif [ -n "$contiene" ] && [[ "$body" != *"$contiene"* ]]; then
    resultado no "$desc" "esperaba que contenga '$contiene', vino -> $body"
  else
    resultado ok "$desc"
  fi
}

capa_bot() {
  titulo "Capa 2 - Workflow de n8n ($BOT)"

  local sonda
  sonda=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BOT" -H "$JSON" -d '{}')
  if [ "$sonda" = "404" ]; then
    printf '  %s el webhook no responde.\n' "$(rojo SALTEADA)"
    printf '       Activa el workflow "Hovy Bot" en n8n (toggle Active, arriba a la derecha).\n'
    return
  fi

  reset_datos

  bot "1. Juan aprueba el turno 142"          "confirmamos el mantenimiento" '{"telefono":"5493511111111","boton_id":"aprobar_turno_142"}'
  bot "2. Ana rechaza el turno 143"           "cancelamos el turno"          '{"telefono":"5493512222222","boton_id":"rechazar_turno_143"}'
  bot "3. Juan responde la encuesta"          "puntaje de 5/5"               '{"telefono":"5493511111111","boton_id":"encuesta_puntaje_5"}'
  bot "4. Juan consulta por texto libre"      "Mza 4 Lote 12"                '{"telefono":"5493511111111","texto":"hola cuando me toca el corte?"}'
  bot "5. Ana ya no tiene turnos"             "No tenés mantenimientos"      '{"telefono":"5493512222222","texto":"hola"}'
  bot "6. telefono no registrado: silencio"   ""                             '{"telefono":"5493519999999","texto":"hola"}'
  bot "7. boton desconocido: silencio"        ""                             '{"telefono":"5493511111111","boton_id":"xyz_123"}'
  bot "8. turno ajeno: silencio"              ""                             '{"telefono":"5493511111111","boton_id":"aprobar_turno_143"}'
  bot "9. encuesta repetida: silencio"        ""                             '{"telefono":"5493511111111","boton_id":"encuesta_puntaje_5"}'

  titulo "Estado final de los datos"
  curl -s -H "$KEY" "$API/_debug/estado"
  printf '\n'
}

# --- Main ---------------------------------------------------------------------
if ! curl -s -o /dev/null -H "$KEY" "$API/_debug/estado"; then
  printf '%s no responde. Levantalo con: npm run dev\n' "$(rojo "El mock en $API")"
  exit 1
fi

capa_mock
[ "${1:-todo}" != "mock" ] && capa_bot

titulo "Resumen"
printf '  %s pasaron, %s fallaron\n\n' "$(verde "$pasaron")" "$([ "$fallaron" -gt 0 ] && rojo "$fallaron" || echo 0)"
[ "$fallaron" -eq 0 ]
