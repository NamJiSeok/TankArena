const crypto = require("node:crypto");
const net = require("node:net");

const PORT = Number(process.env.PORT || 3000);

async function main() {
  let alpha;
  let bravo;

  try {
    alpha = await connectClient("Alpha");
    bravo = await connectClient("Bravo");

    alpha.send("login", { name: "Alpha" });
    bravo.send("login", { name: "Bravo" });
    const alphaProfile = await alpha.waitFor("profile");
    await bravo.waitFor("profile");
    if (!alphaProfile.tankTypes?.length) {
      throw new Error("Missing tank type catalog");
    }

    alpha.send("chat", { scope: "lobby", text: "hello lobby" });
    await bravo.waitFor(
      "chatMessage",
      (chat) => chat.scope === "lobby" && chat.message.text === "hello lobby"
    );

    alpha.send("createRoom", { name: "Smoke Room" });
    const joined = await alpha.waitFor("joinedRoom");
    const roomId = joined.roomId;

    bravo.send("joinRoom", { roomId });
    await bravo.waitFor("joinedRoom");

    alpha.send("selectTank", { tankTypeId: "guardian" });
    await alpha.waitFor("profile", (profile) => profile.tankTypeId === "guardian");

    alpha.send("chat", { scope: "room", text: "hello room" });
    await bravo.waitFor(
      "chatMessage",
      (chat) => chat.scope === "room" && chat.message.text === "hello room"
    );

    alpha.send("setReady", { ready: true });
    bravo.send("setReady", { ready: true });
    await alpha.waitFor(
      "roomState",
      (room) =>
        room.players.every((player) => player.ready) &&
        room.players.some((player) => player.name === "Alpha" && player.tankTypeId === "guardian")
    );

    alpha.send("startGame");
    await alpha.waitFor("gameState", (game) => game.status === "playing" && game.tanks.length === 2);
    await bravo.waitFor("gameState", (game) => game.status === "playing" && game.tanks.length === 2);

    alpha.send("attack", { kind: "melee" });
    await alpha.waitFor(
      "gameState",
      (game) => (game.meleeAttacks || []).some((attack) => attack.ownerId === alphaProfile.id)
    );

    console.log("smoke ok: login, tank catalog, chat, ready, start, melee attack, game state");
  } finally {
    alpha?.close();
    bravo?.close();
  }
}

function connectClient(label) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(PORT, "127.0.0.1");
    const key = crypto.randomBytes(16).toString("base64");
    const client = {
      label,
      socket,
      buffer: Buffer.alloc(0),
      ready: false,
      messages: [],
      waiters: [],
      send(type, data = {}) {
        socket.write(encodeClientFrame(JSON.stringify({ type, data })));
      },
      waitFor(type, predicate = () => true, timeout = 2200) {
        const existingIndex = this.messages.findIndex(
          (message) => message.type === type && predicate(message.data)
        );
        if (existingIndex >= 0) {
          const [message] = this.messages.splice(existingIndex, 1);
          return Promise.resolve(message.data);
        }

        return new Promise((resolveWait, rejectWait) => {
          const timer = setTimeout(() => {
            rejectWait(new Error(`${this.label} timed out waiting for ${type}`));
          }, timeout);
          this.waiters.push({ type, predicate, resolve: resolveWait, reject: rejectWait, timer });
        });
      },
      close() {
        socket.end();
        socket.destroy();
      }
    };

    socket.on("connect", () => {
      socket.write(
        [
          "GET / HTTP/1.1",
          "Host: localhost",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          ""
        ].join("\r\n")
      );
    });

    socket.on("data", (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);

      if (!client.ready) {
        const headerEnd = client.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        const header = client.buffer.subarray(0, headerEnd).toString("utf8");
        if (!header.includes("101 Switching Protocols")) {
          reject(new Error(`${label} websocket upgrade failed`));
          return;
        }
        client.ready = true;
        client.buffer = client.buffer.subarray(headerEnd + 4);
        resolve(client);
      }

      const frames = decodeServerFrames(client);
      for (const frame of frames) {
        const message = JSON.parse(frame);
        dispatch(client, message);
      }
    });

    socket.on("error", reject);
  });
}

function dispatch(client, message) {
  const waiterIndex = client.waiters.findIndex(
    (waiter) => waiter.type === message.type && waiter.predicate(message.data)
  );

  if (waiterIndex >= 0) {
    const [waiter] = client.waiters.splice(waiterIndex, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(message.data);
    return;
  }

  client.messages.push(message);
}

function encodeClientFrame(message) {
  const payload = Buffer.from(message);
  const mask = crypto.randomBytes(4);
  const length = payload.length;
  const header = [];

  header.push(0x81);
  if (length < 126) {
    header.push(0x80 | length);
  } else if (length < 65536) {
    header.push(0x80 | 126, (length >> 8) & 255, length & 255);
  } else {
    throw new Error("Smoke payload too large");
  }

  const masked = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }

  return Buffer.concat([Buffer.from(header), mask, masked]);
}

function decodeServerFrames(client) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= client.buffer.length) {
    const first = client.buffer[offset];
    const second = client.buffer[offset + 1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > client.buffer.length) break;
      length = client.buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > client.buffer.length) break;
      length = Number(client.buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    if (offset + headerLength + length > client.buffer.length) break;

    const payload = client.buffer.subarray(offset + headerLength, offset + headerLength + length);
    offset += headerLength + length;

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    }
  }

  client.buffer = client.buffer.subarray(offset);
  return messages;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
