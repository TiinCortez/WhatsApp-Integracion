# Hovy — Spike de chatbot en n8n

Chatbot de flujo cerrado que resuelve turnos de mantenimiento, construido **sin WhatsApp y sin base
de datos**. Sirve para aprender n8n y para dejar validada la lógica antes de integrarla a Hovy.

La idea es que al integrarlo solo cambien **dos piezas**:

| Pieza | Acá | En Hovy real |
|---|---|---|
| Entrada | Nodo **Webhook** + curl | Nodo **WhatsApp Trigger** |
| Datos | Mock en memoria (`:3000`) | API real de Hovy contra la base |

Todo lo del medio —validar identidad, rutear, armar la respuesta— se escribe una sola vez.

```
curl ──POST──> n8n Webhook ──> Buscar Cliente ──┬── 404 ─────────────> Responder Vacío
                                                │
                                                └── OK ──> Router ──┬─ aprobar_  ─> Confirmar ─┐
                                                                    ├─ rechazar_ ─> Rechazar  ─┤
                                                                    ├─ encuesta_ ─> Encuesta  ─┼─> Set ─> Responder Texto
                                                                    ├─ texto     ─> Próximo   ─┘
                                                                    └─ fallback  ────────────────> Responder Vacío
```

---

## 1. Levantar el mock

```bash
cd hovy-mock
npm install
npm run dev        # queda escuchando en http://localhost:3000
```

Los datos viven en `src/data.js` y se pierden al reiniciar. Para volver al estado inicial sin bajar
el server: `POST /api/bot/_debug/reset`.

### Datos semilla

| Cliente | Teléfono | Inmueble | Turnos |
|---|---|---|---|
| Juan Pérez (1) | `5493511111111` | Villa Allende, Mza 4 Lote 12 | **142** 03/09 `Propuesto` · **144** 20/08 `Realizado` |
| Ana Gómez (2) | `5493512222222` | Valle Escondido, Los Aromos 340 | **143** 05/09 `Confirmado` |

Están elegidos para que cada caso de prueba caiga naturalmente: Juan tiene un turno pendiente (para
aprobar/rechazar) y uno realizado (para la encuesta); Ana no tiene realizados, así que sirve para el
caso "no hay nada para encuestar", y su turno 143 sirve para probar que Juan no pueda tocarlo.

### Endpoints

Todos exigen el header `X-API-Key: hovy-dev-key`.

| Método | Ruta | Body | Devuelve |
|---|---|---|---|
| `GET` | `/api/bot/cliente?telefono=` | — | cliente · `404 cliente_no_encontrado` |
| `GET` | `/api/bot/turnos/proximo?clienteId=` | — | turno + inmueble · `404 sin_turnos` |
| `POST` | `/api/bot/turnos/:id/confirmar` | `{ clienteId }` | turno `Confirmado` · `403 turno_ajeno` |
| `POST` | `/api/bot/turnos/:id/rechazar` | `{ clienteId }` | turno `Cancelado` · `403 turno_ajeno` |
| `POST` | `/api/bot/encuestas` | `{ clienteId, puntaje }` | encuesta · `409 sin_turno_para_encuestar` |
| `GET` | `/api/bot/_debug/estado` | — | volcado de `turnos` y `encuestas` |
| `POST` | `/api/bot/_debug/reset` | — | restaura los datos semilla |

Los endpoints de turno devuelven siempre la **misma forma**, con el inmueble ya incorporado y la
fecha ya formateada, para que las plantillas de n8n sean interpolación pura:

```json
{
  "id_turno": 142, "fecha_programada": "2026-09-03", "fecha_legible": "jueves 03/09",
  "franja_horaria": "Mañana", "estado": "Propuesto", "id_inmueble": 10,
  "barrio": "Villa Allende", "direccion_referencia": "Mza 4 Lote 12", "tipo_inmueble": "Lote Vacio"
}
```

### Dos decisiones de diseño

**El backend resuelve a qué turno pertenece la encuesta.** El botón `encuesta_puntaje_5` lleva el
puntaje, no el `id_turno`. En vez de romper la convención `accion_entidad_id`, el workflow manda
`{ clienteId, puntaje }` y el mock busca el último turno `Realizado` del cliente sin encuesta previa.

**La propiedad de los datos se valida en el backend.** `POST /turnos/143/confirmar` recibe un id
suelto: Juan podría mandar el turno de Ana. Por eso el workflow envía `clienteId` y el mock verifica
que el turno cuelgue de un inmueble suyo → si no, `403` → el bot no responde nada. La regla de
seguridad queda en un solo lugar, que es donde va a estar en Hovy real.

---

## 2. Armar el workflow en n8n

### Opción rápida: importar

En n8n → **Workflows → ⋯ (arriba a la derecha) → Import from File** → elegir
`n8n/hovy-bot.workflow.json`. Funciona tal cual, sin configurar credenciales.

Aun si lo importás, leé la sección siguiente: el objetivo del spike es entender qué hace cada nodo.

### Opción de aprendizaje: armarlo a mano

Tres cosas que conviene saber antes de empezar:

1. **Las expresiones arrancan con `=`.** Un campo que empieza con `=` se evalúa, y lo dinámico va
   entre `{{ }}`. Sin el `=`, lo que escribas es texto literal. En la UI el `=` no se escribe: se
   activa con el toggle **Fixed / Expression** que aparece al pasar el mouse por el campo.
2. **`$json` es el item que entra al nodo actual**, no el mensaje original. Después de *Buscar
   Cliente*, `$json` ya es el cliente. Para volver al webhook: `$('Webhook').first().json.body`.
   Ese salto es el 80% de los errores de un workflow nuevo.
3. **`host.docker.internal`, nunca `localhost`.** n8n corre dentro de Docker: para él `localhost` es
   el propio contenedor, no tu máquina.

> **Por qué `.first()` y no `.item`**: `.item` busca el item "emparejado" con el actual, y en las
> ramas que salen por error ese emparejamiento se pierde y la expresión falla. Como cada mensaje
> entra de a uno, `.first()` da lo mismo y no se rompe nunca.

#### Nodo 1 — `Webhook`

| Campo | Valor |
|---|---|
| HTTP Method | `POST` |
| Path | `hovy-bot` |
| Respond | **Using 'Respond to Webhook' Node** |

Este nodo tiene **dos URLs distintas**, y confundirlas es el tropiezo clásico:

- **Test** — `http://localhost:5678/webhook-test/hovy-bot`. Escucha **una sola** llamada y **solo**
  mientras tengas apretado *Execute workflow*. Es el modo en el que ves los datos correr por el canvas.
- **Producción** — `http://localhost:5678/webhook/hovy-bot`. Anda siempre, pero requiere el workflow
  **Active** (toggle arriba a la derecha). Las ejecuciones se ven en la pestaña *Executions*.

Armá con Test; corré `pruebas.sh` con el workflow Active.

La salida del nodo es `{ headers, params, query, body }` → **tu JSON está en `body`**.

#### Nodo 2 — `HTTP Request`, renombrado a **Buscar Cliente**

| Campo | Valor |
|---|---|
| Method | `GET` |
| URL | `http://host.docker.internal:3000/api/bot/cliente` |
| Send Query Parameters | **ON** → `telefono` = `={{ $json.body.telefono }}` |
| Send Headers | **ON** → `X-API-Key` = `hovy-dev-key` |

En la pestaña **Settings** del nodo: **On Error → Continue (using error output)**. Eso le agrega una
**segunda salida roja** que se dispara con el `404`. Esa salida roja *es* el requisito de seguridad
dibujado en el canvas: teléfono desconocido → el bot no responde.

> **Mejor práctica** (opcional): en vez de repetir el header en los cinco nodos, creá la credencial
> una vez en **Credentials → Add credential → Header Auth** (Name: `X-API-Key`, Value: `hovy-dev-key`)
> y en cada nodo poné *Authentication → Generic Credential Type → Header Auth*. El JSON importable usa
> headers explícitos solo para que ande sin configurar nada.

#### Nodo 3 — `Switch`, renombrado a **Router**

Mode `Rules`, cuatro reglas. En cada una activá **Rename Output** y poné el nombre de la tabla:

| Output | Left Value | Operador | Right Value |
|---|---|---|---|
| `aprobar` | `={{ $('Webhook').first().json.body.boton_id }}` | String → starts with | `aprobar_turno_` |
| `rechazar` | `={{ $('Webhook').first().json.body.boton_id }}` | String → starts with | `rechazar_turno_` |
| `encuesta` | `={{ $('Webhook').first().json.body.boton_id }}` | String → starts with | `encuesta_puntaje_` |
| `texto` | `={{ $('Webhook').first().json.body.texto }}` | String → is not empty | — |

En **Options → Add option → Fallback Output → Extra Output** aparece una quinta salida que recoge
todo lo que no matcheó.

En las opciones de las condiciones, dejá **Type Validation** en *loose*: cuando llega un mensaje de
texto no hay `boton_id`, y en modo estricto un `undefined` haría fallar el nodo en vez de simplemente
no matchear.

#### Nodos 4-7 — Un `HTTP Request` por rama

El id sale del final del `boton_id` con `.split('_').pop()`, directo en la URL. No hace falta un
nodo Code.

**Confirmar Turno** (salida `aprobar`)

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `=http://host.docker.internal:3000/api/bot/turnos/{{ $('Webhook').first().json.body.boton_id.split('_').pop() }}/confirmar` |
| Send Headers | ON → `X-API-Key` = `hovy-dev-key` |
| Send Body | ON → `clienteId` = `={{ $('Buscar Cliente').first().json.id_cliente }}` |
| Settings → On Error | Continue (using error output) → la salida roja va a **Responder Vacío** |

**Rechazar Turno** (salida `rechazar`) — idéntico, cambiando `/confirmar` por `/rechazar`.

**Guardar Encuesta** (salida `encuesta`) — `POST` a `/api/bot/encuestas`, con dos campos en el body:
`clienteId` igual que arriba, y
`puntaje` = `={{ Number($('Webhook').first().json.body.boton_id.split('_').pop()) }}`.
Salida roja → **Responder Vacío**.

**Próximo Turno** (salida `texto`) — `GET` a `/api/bot/turnos/proximo`, query `clienteId` igual que
arriba. Su salida roja **no** va a Responder Vacío: va a **Set Sin Turnos**. El `404` de "no tiene
turnos" no es un error, es una respuesta legítima que merece un mensaje amable.

#### Nodos 8-12 — `Edit Fields (Set)`, uno por plantilla

Cada uno define un solo campo `respuesta` de tipo String. Acá vive el requisito de que el bot nunca
genere texto libre: son literales fijos con datos interpolados.

| Nodo | `respuesta` |
|---|---|
| **Set Confirmado** | `=✅ Listo {{ $('Buscar Cliente').first().json.nombre }}, confirmamos el mantenimiento del {{ $json.fecha_legible }} por la {{ $json.franja_horaria }} en {{ $json.direccion_referencia }}, {{ $json.barrio }}.` |
| **Set Rechazado** | `=Entendido {{ $('Buscar Cliente').first().json.nombre }}, cancelamos el turno del {{ $json.fecha_legible }} en {{ $json.direccion_referencia }}. Nos comunicamos para reprogramar.` |
| **Set Encuesta** | `=¡Gracias por responder, {{ $('Buscar Cliente').first().json.nombre }}! Registramos tu puntaje de {{ $json.puntaje }}/5 para el servicio del {{ $json.fecha_legible }}.` |
| **Set Proximo Turno** | `=Hola {{ $('Buscar Cliente').first().json.nombre }}. Tu próximo mantenimiento es el {{ $json.fecha_legible }} por la {{ $json.franja_horaria }} en {{ $json.direccion_referencia }}, {{ $json.barrio }}. Estado: {{ $json.estado }}.` |
| **Set Sin Turnos** | `=Hola {{ $('Buscar Cliente').first().json.nombre }}. No tenés mantenimientos programados por el momento. Cuando agendemos uno te avisamos por acá.` |

#### Nodos 13-14 — Las dos salidas

**Respond to Webhook** → **Responder Texto**
- Respond With: `JSON`
- Response Body: `={{ JSON.stringify({ respuesta: $json.respuesta }) }}`
- Los **cinco** Set entran a este mismo nodo. En n8n varias conexiones pueden llegar a una misma
  entrada.

**Respond to Webhook** → **Responder Vacío**
- Respond With: **No Data**, Options → Response Code: `200`
- Le entran cuatro cosas: la salida roja de *Buscar Cliente*, el **fallback** del Router, y las
  salidas rojas de *Confirmar* / *Rechazar* / *Encuesta* (ahí caen el `403 turno_ajeno` y el `409`).

Status 200 y body vacío: para el que escribió es indistinguible de que el bot no exista, que es justo
lo que se quiere cuando el teléfono no está registrado.

---

## 3. Probar

```bash
cd hovy-mock
./pruebas.sh          # capa 1 (mock) + capa 2 (workflow)
./pruebas.sh mock     # solo el mock, sin necesitar n8n
```

> **En Windows usá Git Bash.** En PowerShell, `curl` es un alias de `Invoke-WebRequest` y no acepta
> estos flags. Si preferís PowerShell, escribí `curl.exe` explícitamente.

La capa 2 se saltea sola si el workflow no está Active.

### Los 9 casos

| # | Mensaje | Esperado |
|---|---|---|
| 1 | Juan → `aprobar_turno_142` | confirmación; turno 142 → `Confirmado` |
| 2 | Ana → `rechazar_turno_143` | cancelación; turno 143 → `Cancelado` |
| 3 | Juan → `encuesta_puntaje_5` | agradecimiento; `encuestas` recibe `{id_turno:144, puntaje:5}` |
| 4 | Juan → texto libre | fecha y dirección reales del turno 142 |
| 5 | Ana → texto libre *(tras el caso 2)* | "No tenés mantenimientos programados" |
| 6 | Teléfono no registrado | **200 con body vacío** |
| 7 | Botón `xyz_123` | **200 con body vacío** |
| 8 | Juan → `aprobar_turno_143` (turno de Ana) | **200 con body vacío** |
| 9 | Juan → `encuesta_puntaje_5` repetida | **200 con body vacío** |

Los casos 5 y 9 dependen del orden: el script resetea los datos antes de arrancar, así que corrélo
completo.

### Cuando algo falla

| Síntoma | Causa |
|---|---|
| El curl queda colgado | En esa rama no hay un `Respond to Webhook` alcanzable |
| `404 webhook not registered` | El workflow no está **Active**, o le pegás a la URL de producción estando en modo Test |
| `ECONNREFUSED` en un nodo HTTP | Usaste `localhost` en vez de `host.docker.internal`, o el mock no está levantado |
| `401` en un nodo HTTP | Falta el header `X-API-Key` en ese nodo |
| Un campo sale vacío en el mensaje | Casi siempre es `$json` donde correspondía `$('Nodo').first().json`. Abrí *Executions* y mirá el JSON real de entrada del nodo |

---

## 4. El salto a Hovy real

- **Entrada** — reemplazar el nodo *Webhook* por el **WhatsApp Trigger** y agregar un nodo Code que
  normalice el payload de Meta (viene anidado en `entry[0].changes[0].value.messages[0]`) al mismo
  `{ telefono, boton_id, texto }`. De ahí en adelante no cambia nada. Ojo con filtrar los webhooks de
  `statuses` (entregado/leído), que llegan sin `messages`.
- **Datos** — apuntar los cinco nodos HTTP a la API real. Los endpoints `/api/bot/*` están pensados
  como contrato: implementalos en el backend de Hovy contra la base y el workflow no se toca.
- **Salida** — los *Respond to Webhook* pasan a ser llamadas a la Graph API. Ojo acá: el nodo nativo
  de WhatsApp de n8n solo manda texto, template y media; **los botones interactivos salen por un nodo
  HTTP Request**. Y solo se pueden mandar mensajes libres dentro de las 24 h del último mensaje del
  cliente — para recordatorios proactivos hacen falta templates aprobados.
- **Seguridad** — la validación de propiedad ya está del lado del backend, que es donde tiene que
  quedar.

## Fuera de alcance

WhatsApp real, cuenta de Meta, IA para interpretar el texto libre, base de datos, autenticación más
allá de la API key fija, y persistencia entre reinicios.
