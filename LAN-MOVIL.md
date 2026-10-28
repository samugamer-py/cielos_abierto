# Cielos Abiertos: móvil y multijugador LAN

## Jugar en móvil
1. Ejecuta el servidor en el ordenador anfitrión.
2. En el móvil, abre la dirección LAN que muestra el servidor, por ejemplo `http://192.168.1.20:8000/`.
3. Pulsa **Vuelo libre** o entra en **Multijugador**. En móviles compatibles, el juego solicita pantalla completa y orientación horizontal.
4. Usa el joystick izquierdo para controlar el morro y el alabeo. Los botones derechos controlan guiñada, potencia, freno y cámara.

La pantalla completa automática depende del navegador: debe iniciarse tras un toque del usuario y algunos navegadores solo la permiten en una PWA instalada. Si no se activa, usa el botón ⛶.

## Configurar la LAN
1. Con Python 3 instalado, abre una terminal en la carpeta del proyecto.
2. Ejecuta `python server/server.py` (Windows puede requerir `py server/server.py`).
3. El servidor muestra una dirección local y una dirección LAN. Abre la dirección LAN desde cada dispositivo.
4. Todos los dispositivos deben estar en la misma red Wi-Fi/LAN. Autoriza Python en el firewall y permite el puerto TCP `8000`.
5. En **Multijugador**, el campo servidor se rellena automáticamente con el host desde el que abriste el juego. Si hace falta, usa `ws://IP-DEL-ANFITRION:8000/ws`.

No uses `localhost` en los móviles: `localhost` apunta al propio móvil, no al ordenador anfitrión. Para jugar desde fuera de la LAN se necesita un servidor accesible públicamente y una configuración segura; esta configuración está pensada para una red local de confianza.
