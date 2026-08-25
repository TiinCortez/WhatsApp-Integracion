// Reglas de negocio del bot, separadas de Express para que se lean como reglas.
// Cuando esto migre a Hovy real, estas funciones pasan a ser consultas SQL,
// pero el contrato que ve n8n queda igual.

import { clientes, encuestas, inmuebles, turnos } from "./data.js";

const ZONA = "America/Argentina/Buenos_Aires";

/** Estados sobre los que el cliente todavía puede decidir. */
export const ESTADOS_PENDIENTES = ["Propuesto", "Confirmado"];

export function clientePorTelefono(telefono) {
  return clientes.find((c) => c.telefono === telefono) ?? null;
}

export function turnoPorId(idTurno) {
  return turnos.find((t) => t.id_turno === idTurno) ?? null;
}

export function inmueblesDe(idCliente) {
  return inmuebles.filter((i) => i.id_cliente === idCliente);
}

/**
 * Base de toda la seguridad del bot: un turno es del cliente solo si cuelga
 * de un inmueble suyo. Sin esto, cualquier cliente registrado podría confirmar
 * o cancelar el turno de otro mandando su id en el botón.
 */
export function esDuenio(idCliente, turno) {
  const inmueble = inmuebles.find((i) => i.id_inmueble === turno.id_inmueble);
  return inmueble?.id_cliente === idCliente;
}

export function turnosDe(idCliente) {
  const idsPropios = new Set(inmueblesDe(idCliente).map((i) => i.id_inmueble));
  return turnos.filter((t) => idsPropios.has(t.id_inmueble));
}

/** Turno pendiente más cercano en el futuro, o null si no tiene ninguno. */
export function proximoTurno(idCliente) {
  const hoy = hoyISO();
  return (
    turnosDe(idCliente)
      .filter((t) => ESTADOS_PENDIENTES.includes(t.estado) && t.fecha_programada >= hoy)
      .sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada))[0] ?? null
  );
}

/**
 * El botón `encuesta_puntaje_N` trae el puntaje pero no el turno, así que
 * el turno se resuelve acá: el último servicio realizado que todavía no
 * tenga encuesta cargada.
 */
export function turnoParaEncuestar(idCliente) {
  const yaEncuestados = new Set(encuestas.map((e) => e.id_turno));
  return (
    turnosDe(idCliente)
      .filter((t) => t.estado === "Realizado" && !yaEncuestados.has(t.id_turno))
      .sort((a, b) => b.fecha_programada.localeCompare(a.fecha_programada))[0] ?? null
  );
}

/**
 * Turno + datos del inmueble + fecha ya formateada. El formato lo resuelve el
 * backend para que las plantillas de n8n sean interpolación pura, sin lógica.
 */
export function enriquecer(turno) {
  const inmueble = inmuebles.find((i) => i.id_inmueble === turno.id_inmueble);
  return {
    ...turno,
    fecha_legible: fechaLegible(turno.fecha_programada),
    barrio: inmueble.barrio,
    direccion_referencia: inmueble.direccion_referencia,
    tipo_inmueble: inmueble.tipo_inmueble,
  };
}

// "2026-09-03" -> "jueves 03/09".
// El timeZone: "UTC" no es opcional: `new Date("2026-09-03")` es medianoche UTC,
// y formatearla en hora argentina (UTC-3) retrocede al día anterior.
// El día y el mes se arman a mano porque es-AR los separa con guiones ("03-09").
const FORMATO_DIA_SEMANA = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  timeZone: "UTC",
});

export function fechaLegible(fechaISO) {
  const [, mes, dia] = fechaISO.split("-");
  const diaSemana = FORMATO_DIA_SEMANA.format(new Date(`${fechaISO}T00:00:00Z`));
  return `${diaSemana} ${dia}/${mes}`;
}

// Fecha de hoy en Córdoba, no en UTC: entre las 21 y las 24 no son el mismo día.
function hoyISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());
}
