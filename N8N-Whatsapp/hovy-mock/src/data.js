// Datos hardcodeados en memoria: subconjunto simplificado del modelo real de Hovy.
// Los nombres de campo son los definitivos, para que el contrato de la API no cambie
// cuando esto se reemplace por la base relacional.
//
// Los arrays se mutan durante la ejecución y se pierden al reiniciar. Es a propósito.

const SEMILLA = {
  clientes: [
    {
      id_cliente: 1,
      nombre: "Juan",
      apellido: "Pérez",
      telefono: "5493511111111",
      tipo_cliente: "Fijo",
    },
    {
      id_cliente: 2,
      nombre: "Ana",
      apellido: "Gómez",
      telefono: "5493512222222",
      tipo_cliente: "Casual",
    },
  ],

  inmuebles: [
    {
      id_inmueble: 10,
      id_cliente: 1,
      barrio: "Villa Allende",
      direccion_referencia: "Mza 4 Lote 12",
      tipo_inmueble: "Lote Vacio",
    },
    {
      id_inmueble: 11,
      id_cliente: 2,
      barrio: "Valle Escondido",
      direccion_referencia: "Los Aromos 340",
      tipo_inmueble: "Casa Habitada",
    },
  ],

  // 142 futuro y pendiente  -> aprobar / rechazar / consultar (Juan)
  // 143 futuro y confirmado -> probar que Juan NO pueda tocarlo (Ana)
  // 144 pasado y realizado  -> encuesta (Juan). Ana no tiene realizados: caso sin_turno_para_encuestar.
  turnos: [
    {
      id_turno: 142,
      id_inmueble: 10,
      fecha_programada: "2026-09-03",
      franja_horaria: "Mañana",
      estado: "Propuesto",
    },
    {
      id_turno: 143,
      id_inmueble: 11,
      fecha_programada: "2026-09-05",
      franja_horaria: "Tarde",
      estado: "Confirmado",
    },
    {
      id_turno: 144,
      id_inmueble: 10,
      fecha_programada: "2026-08-20",
      franja_horaria: "Mañana",
      estado: "Realizado",
    },
  ],

  encuestas: [],
};

export const clientes = [];
export const inmuebles = [];
export const turnos = [];
export const encuestas = [];

let proximoIdEncuesta = 1;

export function nuevoIdEncuesta() {
  return proximoIdEncuesta++;
}

/** Restaura los cuatro arrays al estado semilla, sin bajar el servidor. */
export function resetear() {
  reemplazar(clientes, SEMILLA.clientes);
  reemplazar(inmuebles, SEMILLA.inmuebles);
  reemplazar(turnos, SEMILLA.turnos);
  reemplazar(encuestas, SEMILLA.encuestas);
  proximoIdEncuesta = 1;
}

// Vacía y recarga en el mismo array para no romper las referencias ya importadas.
function reemplazar(destino, origen) {
  destino.length = 0;
  destino.push(...structuredClone(origen));
}

resetear();
