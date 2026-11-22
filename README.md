# LITUM3D Studio

Abre `index.html` en un navegador con WebGL 2. El editor es estático y no requiere instalación ni conexión. Incluye una imagen de ejemplo. Puedes importar JPG, PNG, WebP y otros formatos que tu navegador pueda decodificar.

En la placa plana, el ancho y el alto corresponden a la cara de la pieza. En las formas envolventes, el diámetro de base corresponde al interior y el relieve se añade hacia fuera. En la poligonal el diámetro se mide entre vértices opuestos del círculo circunscrito. En la cónica, el porcentaje configura el diámetro interior superior. Las fotografías se ajustan a toda la superficie y los perfiles cerrados suavizan la unión de los bordes de la imagen.

El contraluz usa una estimación visual de la luz transmitida según el grosor. Exportar STL descarga una malla binaria de mayor resolución que la vista previa, con coordenadas interpretables en milímetros. La placa queda apoyada sobre su cara lisa y las geometrías envolventes quedan en posición vertical.

## Añadir geometrías

Añade una entrada a `profiles` en `geometry.js` con `label`, `icon`, `closed` y `point(u, v, thickness, options)`. La función devuelve `[x, y, z]` en milímetros para coordenadas `u` y `v` entre 0 y 1. El eje Y es vertical. El grosor cero define el interior o el dorso. Un perfil cerrado comparte la columna de inicio y fin. Si el perfil tiene aristas, usa `segments(count, options)` para alinear la cuadrícula con sus esquinas.

El selector se construye a partir del registro. Si una nueva geometría requiere parámetros, añade sus entradas al panel en `index.html` y conecta su lectura y visibilidad en `studio.js`.

## Ajustar la imagen

Abre **Ajustar imagen** para cambiar brillo, contraste y exposición en EV, girar la foto en incrementos de 90 grados o aplicarle un espejo horizontal. Los cambios se aplican al mapa de grosor de la vista 3D y del STL. **Iluminación** controla el contraluz de la vista previa.

## Soporte de lámpara

Elige una forma cilíndrica, cónica o poligonal y activa **Mostrar soporte en la base**. El soporte añade un aro central con orificio para el portalámparas, brazos y un aro periférico con un escalón de 2 mm que recibe la pantalla. Ajusta el diámetro del orificio, altura interior, grosor, número y ancho de brazos y holgura por lado. Si las medidas impiden generar el soporte, el editor indica qué ajuste revisar.

Usa **Ver desde abajo** para inspeccionar el encaje y **Exportar soporte STL** para descargar la pieza independiente. El botón principal exporta la pantalla. Las medidas son geométricas. El ajuste físico y la resistencia al calor se deben comprobar con el portalámparas y el material finales.

## Usar varias fotos

En **Poligonal**, el número de lados determina las posiciones disponibles. Selecciona una cara para cargar, quitar o editar su foto. En **Plana**, elige de una a tres fotos. Las posiciones ocupan franjas verticales del mismo ancho, de izquierda a derecha, dentro de una única placa.

Al seleccionar o arrastrar varias fotos juntas, se asignan en el orden recibido desde la primera posición. La placa se amplía a dos o tres posiciones automáticamente según la selección. Al subir una sola foto, se reemplaza la posición activa. Una posición vacía conserva el grosor mínimo, con una transición en sus bordes. Los ajustes de imagen son independientes por posición. Las fotos permanecen en memoria al cambiar de geometría o reducir temporalmente el número de posiciones.

**Exportar pieza unida STL** integra la pantalla y el soporte en una sola malla para imprimirlos juntos. La malla conserva las fotos, el orificio y los brazos del soporte. Los botones **Exportar STL** y **Exportar soporte STL** siguen descargando las piezas por separado.

## Zoom y preajustes

Selecciona una cara o posición y abre **Ajustar imagen → Zoom de la foto**. Puedes reducir o ampliar la foto desde el centro entre el 25 % y el 300 %. El zoom se aplica al STL de esa foto. **Restablecer** devuelve la foto seleccionada al 100 %.

En **Preajustes**, escribe un nombre y pulsa **Guardar**. Se conservan la forma, las dimensiones, el grosor, el número de caras o posiciones, el soporte y el contraluz. Vuelve a guardar con el mismo nombre para actualizarlo. Selecciona un preajuste y pulsa **Cargar** para reutilizarlo antes de importar fotos nuevas. Los preajustes se guardan en el navegador y no contienen fotografías ni sus ediciones.

## Borde perimetral

Activa **Borde perimetral → Añadir borde**. El ancho se mide hacia el interior: en la placa recorre los cuatro lados y en las formas envolventes se mide en vertical desde los cantos superior e inferior. La altura adicional se suma al grosor máximo de la litofanía y hace sobresalir el borde hacia fuera. Los ajustes se guardan en los preajustes e intervienen tanto en el STL de la pantalla como en el STL de la pieza unida.

## Fotos en el cilindro

El cilindro divide la circunferencia en posiciones iguales. Selecciona varias fotos de golpe para crear sus posiciones automáticamente, o usa **+** y **−** para ajustar cuántas caben según el diámetro, el alto y el encuadre. Cada foto conserva sus proporciones, incluso si se usa una sola. El espacio restante se imprime con el grosor mínimo. El número de posiciones también se guarda en los preajustes.

## Arco, portavelas y florero

**Arco** crea una pantalla abierta con ángulo regulable de 35° a 330°. El diámetro es el del círculo del que parte el arco. Puedes añadir un borde que recorre sus cuatro cantos y un soporte circular para lámpara, que se descarga como STL separado.

**Portavelas** y **Florero** tienen un fondo sólido integrado de grosor regulable y una boca abierta. El portavelas está pensado para velas LED. Para flores con agua, usa un recipiente interior. Las medidas específicas de cada forma se pueden guardar en preajustes.

El arco, el portavelas y el florero también admiten varias fotos. Puedes seleccionarlas de golpe o ajustar las posiciones con **+** y **−**. Con una sola foto, se centra y mantiene la proporción en la superficie. En los recipientes, el encuadre compensa los cambios de diámetro entre la base, el cuerpo y la boca. El número de posiciones se puede guardar en un preajuste.

En **Geometría**, elige un perfil de recipiente. **Portavelas** ofrece Redondo, Cuenco, Tulipa y Barril. **Florero** ofrece Clásico, Botella, Ánfora y Trompeta. El diámetro indicado corresponde a la base. El perfil elegido se guarda en los preajustes y se aplica al encuadre de las fotos y al STL.
