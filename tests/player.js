"use strict";
const video = document.getElementById("video"), player = document.getElementById("player");
const canvas = document.createElement("canvas");
canvas.width = 640; canvas.height = 360;
const ctx = canvas.getContext("2d");
function frame() {
  ctx.fillStyle = "#365a70";
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = "#80cbc4";
  ctx.beginPath();
  ctx.arc(320 + Math.sin(performance.now() / 1000) * 180, 110, 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "24px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "white";
  ctx.fillText("These subtitles are part of the video.", 320, 320);
  requestAnimationFrame(frame);
}
frame();
video.srcObject = canvas.captureStream(15);
document.getElementById("play").onclick = () => video.play();
document.getElementById("resize").onclick = () => {
  const small = player.getBoundingClientRect().width === 640;
  player.style.width = small ? "480px" : "640px";
  player.style.height = small ? "270px" : "360px";
};
document.getElementById("fullscreen").onclick = () => player.requestFullscreen();
document.getElementById("native").onclick = () => video.requestFullscreen();
