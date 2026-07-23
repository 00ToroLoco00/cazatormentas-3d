# Cazatormentas 3D

Prototipo de un simulador meteorológico 3D para navegador, inspirado en las
pampas de Uruguay. La atmósfera evoluciona automáticamente: se forman nubes,
una tormenta se organiza, puede generar un tornado de cono y finalmente se
disipa.

**Demo:** https://cazatormentas-3d.iblamesael.chatgpt.site

## MVP actual

- Ciclos meteorológicos rápidos de 3–6 minutos.
- Una tormenta activa a la vez.
- Probabilidad tornádica elevada para facilitar las pruebas.
- Intensidad determinada por potencial atmosférico y azar ponderado.
- Tornados provisionales EF1–EF5; EF1–EF3 son más frecuentes.
- Nubes por capas y lluvia de intensidad variable.
- Campos, chacras, una pequeña localidad, carreteras y tendido eléctrico.
- Cámara libre con WASD y ratón, velocidad ajustable, seguimiento y teletransporte.
- Paneles minimizables para condiciones, evolución, radar e intensidad.

## Controles

- `W`, `A`, `S`, `D`: mover la cámara.
- Ratón: mirar después de hacer clic sobre el mundo.
- `Espacio`: subir.
- `C` o `Ctrl`: bajar.
- `Shift`: desplazamiento rápido.
- `Esc`: liberar el cursor.

## Arquitectura

- `app/game/simulation.ts`: estado meteorológico autoritativo y reproducible.
- `app/game/config.ts`: ritmos, mundo, probabilidades y espacios para sistemas futuros.
- `app/game/types.ts`: contratos compartidos entre simulación, interfaz y renderizado.
- `app/components/StormScene.tsx`: representación WebGL y cámara.
- `app/components/WeatherHud.tsx`: instrumentos y controles.
- `app/components/RadarPanel.tsx`: representación del radar.

La simulación no depende del renderizador. Esto permite incorporar vehículos,
sondas, daños, nuevas morfologías de tornado o sincronización multijugador sin
convertir el prototipo actual en un callejón sin salida.

## Desarrollo

```bash
npm install
npm run dev
```

Validación:

```bash
npm run lint
npm test
```

## Licencia

Este proyecto se distribuye bajo la licencia GNU General Public License v3.0.
Consulta el archivo `LICENSE` para conocer los términos completos.
