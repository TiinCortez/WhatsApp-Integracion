// Backend mock del bot de Hovy. Todo en memoria, sin base de datos.
// El objetivo es que n8n hable con un contrato HTTP estable: cuando llegue
// la base real, se reimplementan estos endpoints y el workflow no se toca.

import express from "express";

import { encuestas, nuevoIdEncuesta, resetear, turnos } from "./data.js";
import {
  ESTADOS_PENDIENTES,
  clientePorTelefono,
  enriquecer,
  esDuenio,
  proximoTurno,
  turnoParaEncuestar,
  turnoPorId,
} from "./reglas.js";

const PUERTO = Number(process.env.PORT ?? 3000);
const API_KEY = process.env.HOVY_API_KEY ?? "hovy-dev-key";

const app = express();
app.use(express.json());

/** Respuesta de error uniforme, para que n8n siempre encuentre los mismos campos. */
function error(res, status, codigo, mensaje) {
  return res.status(status).json({ error: codigo, mensaje });
}

// Toda /api/bot exige la API key. En Hovy real esto va a ser el token del servicio n8n.
app.use("/api/bot", (req, res, next) => {
  if (req.get("X-API-Key") !== API_KEY) {
    return error(res, 401, "api_key_invalida", "Falta o no coincide el header X-API-Key.");
  }
  next();
});

// --- Identidad --------------------------------------------------------------

// Primer paso de todo mensaje entrante: el teléfono tiene que ser de un cliente
// registrado. Si devuelve 404, el bot no responde nada.
app.get("/api/bot/cliente", (req, res) => {
  const telefono = String(req.query.telefono ?? "");
  const cliente = clientePorTelefono(telefono);

  if (!cliente) {
    return error(res, 404, "cliente_no_encontrado", `No hay ningún cliente con el teléfono ${telefono}.`);
  }
  res.json(cliente);
});

// --- Turnos -----------------------------------------------------------------

app.get("/api/bot/turnos/proximo", (req, res) => {
  const idCliente = Number(req.query.clienteId);
  if (!Number.isInteger(idCliente)) {
    return error(res, 400, "cliente_requerido", "Falta el parámetro clienteId.");
  }

  const turno = proximoTurno(idCliente);
  if (!turno) {
    return error(res, 404, "sin_turnos", "El cliente no tiene mantenimientos programados.");
  }
  res.json(enriquecer(turno));
});

const NUEVO_ESTADO = {
  confirmar: "Confirmado",
  rechazar: "Cancelado",
};

function cambiarEstado(req, res, accion) {
  const idTurno = Number(req.params.id);
  const idCliente = Number(req.body?.clienteId);

  if (!Number.isInteger(idCliente)) {
    return error(res, 400, "cliente_requerido", "Falta clienteId en el body.");
  }

  const turno = turnoPorId(idTurno);
  if (!turno) {
    return error(res, 404, "turno_no_encontrado", `No existe el turno ${idTurno}.`);
  }
  if (!esDuenio(idCliente, turno)) {
    return error(res, 403, "turno_ajeno", "El turno no pertenece a un inmueble de este cliente.");
  }
  if (!ESTADOS_PENDIENTES.includes(turno.estado)) {
    return error(res, 409, "estado_invalido", `El turno ya está en estado ${turno.estado}.`);
  }

  turno.estado = NUEVO_ESTADO[accion];
  res.json(enriquecer(turno));
}

app.post("/api/bot/turnos/:id/confirmar", (req, res) => cambiarEstado(req, res, "confirmar"));
app.post("/api/bot/turnos/:id/rechazar", (req, res) => cambiarEstado(req, res, "rechazar"));

// --- Encuestas --------------------------------------------------------------

app.post("/api/bot/encuestas", (req, res) => {
  const idCliente = Number(req.body?.clienteId);
  const puntaje = Number(req.body?.puntaje);

  if (!Number.isInteger(idCliente)) {
    return error(res, 400, "cliente_requerido", "Falta clienteId en el body.");
  }
  if (!Number.isInteger(puntaje) || puntaje < 1 || puntaje > 5) {
    return error(res, 400, "puntaje_invalido", "El puntaje tiene que ser un entero de 1 a 5.");
  }

  // El botón solo trae el puntaje: el turno se resuelve del lado del backend.
  const turno = turnoParaEncuestar(idCliente);
  if (!turno) {
    return error(res, 409, "sin_turno_para_encuestar", "No hay un servicio realizado pendiente de encuesta.");
  }

  const encuesta = { id_encuesta: nuevoIdEncuesta(), id_turno: turno.id_turno, puntaje };
  encuestas.push(encuesta);

  res.status(201).json({ ...enriquecer(turno), ...encuesta });
});

// --- Utilidades de desarrollo (no existen en Hovy real) ---------------------

app.get("/api/bot/_debug/estado", (_req, res) => {
  res.json({ turnos, encuestas });
});

app.post("/api/bot/_debug/reset", (_req, res) => {
  resetear();
  res.json({ ok: true, mensaje: "Datos restaurados al estado semilla." });
});

app.use((req, res) => error(res, 404, "ruta_no_encontrada", `No existe ${req.method} ${req.path}.`));

app.listen(PUERTO, () => {
  console.log(`hovy-mock escuchando en http://localhost:${PUERTO}`);
  console.log(`Desde n8n en Docker: http://host.docker.internal:${PUERTO}`);
});
