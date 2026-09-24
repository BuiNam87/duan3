// Cấu hình selector cho từng trang. Các trang này thay đổi giao diện thường xuyên,
// nên mọi selector đều có thể sửa trong phần "Cài đặt" của panel.
const PRESETS = {
  chatgpt: {
    name: "ChatGPT",
    hosts: ["chatgpt.com", "chat.openai.com"],
    input: "#prompt-textarea",
    send: 'button[data-testid="send-button"]',
    stop: 'button[data-testid="stop-button"]'
  },
  gemini: {
    name: "Gemini",
    hosts: ["gemini.google.com"],
    input: "rich-textarea .ql-editor",
    send: "button.send-button:not(.stop)",
    stop: "button.send-button.stop"
  },
  claude: {
    name: "Claude",
    hosts: ["claude.ai"],
    input: 'div.ProseMirror[contenteditable="true"]',
    send: 'button[aria-label="Send message"], button[aria-label="Gửi tin nhắn"]',
    stop: 'button[aria-label="Stop response"], button[aria-label="Dừng phản hồi"]'
  },
  generic: {
    name: "Trang khác (tự dò)",
    hosts: [],
    input: "",
    send: "",
    stop: ""
  }
};

function detectPreset(url) {
  try {
    const host = new URL(url).hostname;
    for (const [key, p] of Object.entries(PRESETS)) {
      if (p.hosts.some((h) => host === h || host.endsWith("." + h))) return key;
    }
  } catch (_) {}
  return "generic";
}
