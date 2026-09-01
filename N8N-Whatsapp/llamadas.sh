#!/usr/bin/env bash
# Las 5 llamadas que recorren todas las ramas del bot.
# Correr desde Git Bash, NO desde PowerShell.
#
# MODO TEST (por defecto): hay que apretar "Execute workflow" en n8n ANTES de
# cada llamada. El webhook escucha una sola vez por click.
#
# MODO PRODUCCION: publica/activa el workflow y descomenta la segunda linea.

BOT="http://localhost:5678/webhook-test/hovy-bot"
# BOT="http://localhost:5678/webhook/hovy-bot"

llamar() { echo "--- $1"; curl -s -i -X POST "$BOT" -H "Content-Type: application/json" -d "$2"; echo; echo; }

# 1) TEXTO LIBRE -> rama "texto" -> responde con el proximo turno
llamar "texto libre (Juan)" '{"telefono":"5493511111111","texto":"hola cuando me toca el corte?"}'

# 2) APROBAR -> rama "aprobar" -> turno 142 pasa a Confirmado
llamar "aprobar turno 142 (Juan)" '{"telefono":"5493511111111","boton_id":"aprobar_turno_142"}'

# 3) ENCUESTA -> rama "encuesta" -> guarda puntaje 5 del turno 144 (Realizado)
llamar "encuesta puntaje 5 (Juan)" '{"telefono":"5493511111111","boton_id":"encuesta_puntaje_5"}'

# 4) RECHAZAR -> rama "rechazar" -> turno 142 pasa a Cancelado
llamar "rechazar turno 142 (Juan)" '{"telefono":"5493511111111","boton_id":"rechazar_turno_142"}'

# 5) NUMERO NO REGISTRADO -> salida roja de Buscar Cliente -> 200 SIN BODY
llamar "numero no registrado" '{"telefono":"5493519999999","texto":"hola"}'
