# MTG Tabletop

MTG Tabletop 是一个面向朋友娱乐对局的《万智牌》双人网页牌桌。它提供牌库、手牌、战场、堆叠、坟场、放逐区、备牌、Token、骰子、阶段推进和对局记录等桌面能力，让玩家可以像使用实体牌桌或 Tabletop Simulator 一样远程对战。

> 项目定位：轻量级数字牌桌，不是完整自动规则引擎。玩家自行判断费用、优先权、合法目标、状态动作和裁定；工具负责同步桌面状态与降低操作成本。

---

## 功能概览

| 模块 | 能力 |
| --- | --- |
| 房间 | 创建 / 加入双人房间，本机双开、局域网或公网临时远程对战 |
| 牌库 | 文本牌表导入、洗牌、抓牌、调度、找牌、看牌库顶 |
| 备牌 | 空行后的牌自动作为备牌，支持主牌 / 备牌换备界面 |
| 战场 | 双人对坐牌垫，地与非地分层，对手牌倒置显示，桌面牌库 / 坟场 / 放逐区 |
| 堆叠 | 实体牌和异能分开处理，异能可直接“处理异能” |
| 区域 | 手牌、牌库、战场、坟场、放逐区、堆叠 |
| 依附 | 支持把场上牌拖到另一张牌上，模拟佩戴 / 灵气 / 依附 |
| Token | 自定义名称和可选攻防，支持直接移出游戏 |
| 辅助 | 生命、阶段、+1/+1 指示物、牌上计数器、桌面计数器、公开骰子 |
| 流程 | 先后手选择、战场中央阶段控制、回合结束 |
| 记录 | 公开记录、聊天记录、仅自己可见的私密记录 |

---

## 安装指南

### 1. 安装基础环境

推荐环境：

- Windows 10 / 11
- Git
- Node.js 22 LTS 或更新的 LTS 版本
- pnpm

检查是否已经安装：

```powershell
git --version
node -v
npm -v
pnpm -v
```

如果没有 Node.js，可以从官网安装 LTS 版本：

- https://nodejs.org/

安装 Node.js 后，如果还没有 pnpm：

```powershell
npm install -g pnpm
```

如果 PowerShell 提示脚本执行策略限制，可以执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 2. 克隆项目

```powershell
cd D:\
git clone https://github.com/Ordoviciancn/MTG-Tabletop.git
cd D:\MTG-Tabletop
```

如果你已经有项目目录，只需要进入目录：

```powershell
cd D:\MTG-Tabletop
```

### 3. 安装依赖

```powershell
pnpm install
```

### 4. 启动开发服务

```powershell
pnpm dev
```

启动后访问：

- 前端：http://127.0.0.1:5180
- 后端健康检查：http://127.0.0.1:8787/health

### 5. 构建生产版本

```powershell
pnpm build
```

构建产物会输出到 `dist/`。

### 6. 启动本地生产服务

```powershell
pnpm start
```

默认服务地址：

```txt
http://127.0.0.1:8787
```

---

## Windows 快捷脚本

项目提供了几个 Windows 脚本，适合不想手动输入 pnpm 命令时使用。

| 脚本 | 用途 |
| --- | --- |
| `scripts\dev.cmd` | 启动开发前端和后端 |
| `scripts\build.cmd` | 类型检查并构建前端 |
| `scripts\remote.cmd` | 构建并通过 Cloudflare Quick Tunnel 暴露公网临时链接 |
| `scripts\show-lan-address.cmd` | 显示局域网访问地址 |

示例：

```powershell
cd D:\MTG-Tabletop
.\scripts\dev.cmd
```

---

## 远程对战

### 本机双开测试

1. 启动服务。
2. 打开两个浏览器窗口。
3. 一个窗口创建房间。
4. 另一个窗口输入房间码加入。

### 局域网对战

同一 Wi-Fi 或局域网下，可以运行：

```powershell
.\scripts\show-lan-address.cmd
```

把输出的地址发给同一局域网内的另一台设备，例如：

```txt
http://你的IPv4:5180
```

### 公网临时远程

使用 Cloudflare Quick Tunnel：

```powershell
.\scripts\remote.cmd
```

脚本会自动：

1. 下载 `cloudflared` 到 `tools\cloudflared.exe`。
2. 构建前端。
3. 启动本地服务。
4. 生成 `https://*.trycloudflare.com` 临时链接。

把生成的 HTTPS 链接发给对手即可。

注意：

- 游玩期间不要关闭终端窗口。
- Quick Tunnel 是临时开发 / 测试方案，没有长期在线保证。
- 每次生成的公网地址可能不同。

---

## 牌表格式

基础格式：

```txt
4 Lightning Bolt
4 Counterspell
24 Island
```

空行后的牌会作为备牌：

```txt
4 Lightning Bolt
4 Counterspell
24 Island

2 Dispel
2 Negate
1 Pithing Needle
```

也兼容 `SB:` 和 `Sideboard`：

```txt
4 Lightning Bolt
4 Counterspell

Sideboard
2 Dispel
SB: 2 Negate
```

说明：

- 当前不自动识别地牌、法术、瞬间或生物。
- 导入后所有牌默认按普通牌处理。
- 在战场中拖到“地”区域就按地摆放，拖到“非地”区域就按非地摆放。

---

## 基本对局流程

1. 创建或加入房间。
2. 双方导入牌表；未导入前牌桌会提示先导入。
3. 在“先后手”中选择先手玩家。
4. 如需换备，打开“换备”界面调整主牌 / 备牌。
5. 洗牌。
6. 抓 7。
7. 根据需要调度。
8. 使用战场中间的阶段按钮推进回合。
9. 通过点击按钮或拖拽移动牌。

---

## 操作说明

### 先后手与阶段

- 可以选择“我先手”或“对手先手”。
- 当前先手会作为公开信息显示。
- 阶段控制位于战场中间，按钮为“上一阶段 / 下一阶段 / 结束回合”。
- 阶段数字仍可点击，用于直接切到指定阶段。

### 移动牌

点击一张牌后，可以使用左侧“移动选中牌”移动到：

- 非地战场
- 地区域
- 堆叠
- 坟场
- 放逐
- 手牌
- 牌库顶
- 牌库底
- 洗回牌库

也可以直接拖拽到对应区域。

### 战场

- 双方对坐布局。
- 对手牌倒置显示。
- 地与非地分层。
- 战场下方显示桌面牌库、坟场和放逐区。
- 点击自己的牌库区域可以抓 1。
- 右键战场牌可横置 / 重置。
- 选中牌后可以盖放 / 翻开；盖放牌会显示为风格化牌背。
- 不在牌面显示类型标签，桌面更干净。

### 堆叠

堆叠分为两类项目：

- 实体牌：可以进坟、放逐或进场。
- 异能：只能点击“处理异能”，不会进入坟场、放逐或战场。

从战场把永久物拖到堆叠时，会创建“该牌的异能”堆叠项目，源牌仍留在战场。

手牌右侧有 Cast 区，将手牌拖入 Cast 区会自动进入堆叠。

### 佩戴 / 依附

- 将战场上的一张牌拖到另一张牌上，即可依附在其后方。
- 可用于模拟神器武具、灵气、临时贴附效果等。
- 选中被依附的牌后，可以点击“摘下”解除依附。
- 依附关系只负责视觉和桌面状态，不做规则合法性检查。

### 备牌

- 点击“换备”打开主牌 / 备牌界面。
- 同卡名会合并为一行。
- 列表区域支持鼠标滚轮上下翻动。
- 可以点击“移入一张 / 移出一张”，也可以拖动按钮到另一侧。
- 换备详情只会进入“仅你可见”的私密记录。

### 看牌库顶

- 输入数量 X。
- 点击“看牌库顶”。
- 弹窗显示本次查看的牌。
- 每处理一张，弹窗中的牌数减少一张。
- 如果关闭弹窗后仍有未处理牌，可点击“继续处理 N”恢复。
- 查看内容和处理细节只写入自己的私密记录。

### Token

- 可自定义 Token 名称。
- 可选择是否填写攻防。
- 浏览器会记忆上一次 Token 设置。
- 选中 Token 后，可以点击“移出 Token”直接移出游戏。

### 计数器

支持两类计数器：

- 牌上计数器：+1/+1 指示物和通用计数器。
- 桌面计数器：不依附任何牌，用于风暴数、能量、经验、临时统计等。

### 记录系统

记录分为两类：

- 公开记录：双方都能看到，包括先后手、阶段、生命、移动牌、投骰、聊天等。
- 私密记录：只有自己能看到，包括换备细节、看牌库顶内容等。

公开记录会以“公开｜类别”的形式显示，私密记录会以“私密｜类别”的形式显示，便于复盘时区分信息来源。

---

## 技术架构

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19 + Vite + TypeScript |
| 后端 | Node.js + Express |
| 实时同步 | WebSocket |
| 构建与包管理 | pnpm |
| 公网临时访问 | Cloudflare Quick Tunnel |

项目结构：

```txt
MTG-Tabletop/
├─ src/
│  ├─ client/        # React 前端
│  ├─ server/        # Express + WebSocket 后端
│  └─ shared/        # 前后端共享类型
├─ scripts/          # Windows 启动 / 构建 / 远程脚本
├─ dist/             # 构建产物
└─ README.md
```

---

## 常见问题

### `pnpm` 不是内部或外部命令

说明 pnpm 没有安装或没有加入 PATH。

```powershell
npm install -g pnpm
```

然后重新打开 PowerShell。

### PowerShell 不允许运行脚本

执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### GitHub push 失败但浏览器能打开 GitHub

可能是 Git 没有走浏览器代理，或网络暂时不稳定。先检查：

```powershell
Test-NetConnection github.com -Port 443
```

如果失败，等网络恢复或配置 Git 代理后再执行：

```powershell
git push origin main
```

### 公网链接打不开

- 确认 `remote.cmd` 窗口没有关闭。
- 等待 Cloudflare Tunnel 完全连接成功。
- 重新运行脚本获取新的临时链接。

---

## 项目边界

当前版本专注娱乐桌面模拟，暂不包含：

- 官方卡图与 Oracle 文本。
- 官方万智牌牌背图像；当前牌背为 CSS 绘制的风格化牌背。
- 摩登禁牌表。
- 套牌合法性校验。
- 自动费用支付。
- 自动优先权系统。
- 完整规则引擎。
- 自动裁定。
- 账号系统。
- 匹配 / 天梯。
- 对局回放。
- 服务端持久化。

---

## 验证状态

当前版本已验证：

- `pnpm build` 通过。
- 后端 `/health` 可访问。
- WebSocket 基础流程可用：
  - 创建房间。
  - 第二玩家加入。
  - 导入牌表。
  - 洗牌。
  - 抓牌。
  - 移动牌。

---

## 免责声明

本项目是非官方娱乐工具，与 Wizards of the Coast 无关联。

《Magic: The Gathering》及相关名称、规则、卡牌文本和素材版权归其权利方所有。本项目不内置官方卡图、官方 Oracle 数据库或完整规则数据库。
