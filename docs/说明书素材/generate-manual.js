// ============================================================
// RatHeart-SimPro 用户说明书 docx 生成
// R1 封面配方 + MC-1 Medical Blue;3 节(封面/目录/正文);
// 10 章正文 + 12 张红色标注截图;图注编号自动取自 boxes.json
// ============================================================
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, TableOfContents, LevelFormat,
} = require("docx");
const fs = require("fs");
const { imageSize } = require("image-size");

const ANNO = "/tmp/shots/annotated";
const boxes = JSON.parse(fs.readFileSync("/tmp/shots/boxes.json", "utf-8"));
const OUT = "/tmp/docxgen/用户说明书_v0.2.0.docx";

// ---------- MC-1 Medical Blue ----------
const PAL = {
  bg: "F5F8FC", primary: "1A5276", accent: "2E86C1",
  cover: { titleColor: "1A5276", subtitleColor: "606060", metaColor: "707070", footerColor: "A0A0A0" },
  table: { headerBg: "2E86C1", headerText: "FFFFFF", accentLine: "1A5276", innerLine: "D0DDE8", surface: "EDF3F8" },
};
const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

// ---------- 封面计算函数(design-system 原版) ----------
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."\uff0c\u3002\u3001\uff1b\uff1a\uff01\uff1f", ..."\u7684\u4e0e\u548c\u53ca\u4e4b\u5728\u4e8e\u4e3a", ..."-_\u2014\u2013\u00b7/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine + 1; i < charsPerLine * 1.3 + 1 && i <= remaining.length; i++) {
      if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1], nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
          /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) breakAt -= 1;
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / (pt * 20));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLines(title, charsPerLine(minPt)); titlePt = minPt; }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
          metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45), rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, midSpacing: Math.max(safeRemaining - topSpacing - bottomSpacing, 0), bottomSpacing };
}

// ---------- R1 封面 ----------
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: P.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: P.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.subtitleColor, font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.metaColor, font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders, children })],
    })],
  })];
}

// ---------- 正文组件 ----------
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 140 },
    children: [new TextRun({ text, bold: true, size: 32, color: PAL.primary, font: { ascii: "Arial", eastAsia: "SimHei" } })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 100 },
    children: [new TextRun({ text, bold: true, size: 26, color: PAL.table.accentLine, font: { ascii: "Arial", eastAsia: "SimHei" } })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: opts.noIndent ? undefined : { firstLine: 480 },
    spacing: { line: 312, after: opts.after ?? 60 },
    children: [new TextRun({ text, size: 24, color: "182030" })],
  });
}
function bodyRuns(runs, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: opts.noIndent ? undefined : { firstLine: 480 },
    spacing: { line: 312, after: opts.after ?? 60 },
    children: runs,
  });
}
function bold(t) { return new TextRun({ text: t, bold: true, size: 24, color: PAL.primary }); }
function plain(t) { return new TextRun({ text: t, size: 24, color: "182030" }); }

let listSeq = 0;
function numList(items) {
  listSeq += 1;
  const ref = `list-${listSeq}`;
  numberingConfig.push({
    reference: ref,
    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
               style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
  });
  return items.map(t => new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { line: 312, after: 40 },
    children: Array.isArray(t) ? t : [plain(t)],
  }));
}

// 图片:按原图比例,全屏宽 600px,小图按像素 1:1(≤420px)
let figNo = 0;
function figure(name, caption) {
  figNo += 1;
  const path = `${ANNO}/${name}.png`;
  const buf = fs.readFileSync(path);
  const dim = imageSize(buf);
  const displayWidth = Math.min(600, dim.width);
  const displayHeight = Math.round(displayWidth * dim.height / dim.width);
  const meta = boxes[name] || { items: [] };
  const legend = meta.items.map((it, i) => `${i + 1}\u2002${it.label}`).join("\u3002");
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true,
      children: [new ImageRun({ data: buf, transformation: { width: displayWidth, height: displayHeight }, type: "png" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: `图 ${figNo}\u2002${caption}`, bold: true, size: 20, color: PAL.primary })],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 },
      children: [new TextRun({ text: `图中红框编号说明:${legend}。`, size: 20, color: "506070" })],
    }),
  ];
}

const numberingConfig = [];

// ============================================================
// 正文内容
// ============================================================
const bodyChildren = [];

// ---- 1 软件简介 ----
bodyChildren.push(h1("一、软件简介"));
bodyChildren.push(body("RatHeart-SimPro(大鼠心血管实验台)是一款面向药理学教学的计算机模拟软件。它在计算机中建立大鼠心血管系统的数学模型,学生通过静脉注射药物或刺激自主神经,观察动脉血压、心室压与心率的实时变化,从而理解药物的作用机制与心血管生理调节过程。"));
bodyChildren.push(body("软件支持两种使用模式:"));
bodyChildren.push(...numList([
  [bold("桌面安装版"), plain("(推荐教学机使用):无需联网即可完成全部实验,并内置授课广播服务,可让全班学生通过浏览器实时观看教师的实验画面。")],
  [bold("网页版"), plain("教师在教学机启动服务后,师生通过浏览器访问。适合机房统一部署。")],
]));
bodyChildren.push(body("软件界面全中文,内置 42 种常用与未知药物、5 条自主神经刺激通路,实验曲线以五通道图纸记录仪形式呈现,与真实生理记录仪的操作习惯一致。全部实验计算在本地完成,不上传任何数据。"));

// ---- 2 安装与启动 ----
bodyChildren.push(h1("二、安装与启动"));
bodyChildren.push(h2("2.1 下载安装包"));
bodyChildren.push(body("从软件发布页(GitHub Releases)下载对应平台的安装包:"));
bodyChildren.push(...numList([
  [bold("Windows:"), plain("RatHeart-SimPro_版本号_x64-setup.exe,双击运行,按中文安装向导完成安装(约 2.4 MB)。")],
  [bold("Linux:"), plain("deb 包(Debian/Ubuntu 22.04+)或 rpm 包(Fedora/RHEL 系),约 3.7 MB;另提供免安装 AppImage。")],
  [bold("macOS:"), plain("universal dmg,同时支持 Intel 与 Apple Silicon 芯片,需 macOS 12 及以上。")],
]));
bodyChildren.push(h2("2.2 首次运行提示"));
bodyChildren.push(...numList([
  "Windows:安装包未做代码签名,首次运行若出现 SmartScreen 蓝色提示,点击「更多信息」→「仍要运行」;若防火墙弹窗询问,请允许访问(授课广播需要)。",
  "macOS:首次打开若提示无法验证开发者,在程序目录中右键点击应用 →「打开」。",
  "Linux:deb/rpm 安装后从应用菜单启动;AppImage 需先赋予可执行权限。",
]));
bodyChildren.push(body("安装完成后桌面版即开即用,无需安装其他运行环境。启动后进入主界面(见第三章)。"));

// ---- 3 界面总览 ----
bodyChildren.push(h1("三、界面总览"));
bodyChildren.push(body("软件主界面分为左右两栏与底部功能区。左侧为实验操作区,右侧大面积区域为血压与心率记录区,底部为实验制备与实验记录区。启动后的完整界面如图 1 所示。"));
bodyChildren.push(...figure("s01-main", "软件主界面(实验就绪状态)"));
bodyChildren.push(...numList([
  [bold("动物模型区"), plain(":选择去脑大鼠或正常大鼠,新建实验。")],
  [bold("给药注射区"), plain(":选择药物与剂量,静脉注射。")],
  [bold("神经刺激区"), plain(":选择刺激通路,刺激自主神经。")],
  [bold("血压与心率记录区"), plain(":五通道图纸记录仪,实时绘制曲线。")],
  [bold("走纸控制区"), plain(":开始/暂停记录、快进、调速、导入导出与授课广播。")],
  [bold("实验记录区"), plain(":按时间顺序列出全部实验操作事件。")],
]));

// ---- 4 基本实验流程 ----
bodyChildren.push(h1("四、基本实验流程"));
bodyChildren.push(body("一个典型的教学实验按以下顺序进行:新建实验 → 选择动物模型 → 开始记录 → 注射药物/刺激神经 → 观察反应 → 停止或导出。"));
bodyChildren.push(h2("4.1 选择动物模型"));
bodyChildren.push(body("点击「新建实验」开始新实验。两种动物模型的差异:去脑大鼠保留压力感受器反射,基础心率较低;正常大鼠保留完整中枢神经反射,心率与血压调节更接近生理状态。记录开始后模型不可切换,与真实实验规范一致。"));
bodyChildren.push(...figure("s02-model", "动物模型卡片"));
bodyChildren.push(h2("4.2 开始记录与给药"));
bodyChildren.push(body("点击「开始记录」后,五通道曲线开始走纸。在给药注射区选择药物分组(激动药/拮抗抑制药/未知药)、具体药物与剂量,点击「注射药物」。药物注入静脉循环后按一阶动力学衰减,血压与心率随之变化。例如注射 2 μg/kg 肾上腺素并快进观察,可见血压明显升高、心率加快(图 3)。"));
bodyChildren.push(...figure("s04-recording", "记录中:注射肾上腺素后的曲线反应"));
bodyChildren.push(h2("4.3 刺激自主神经"));
bodyChildren.push(body("在神经刺激区选择通路后点击「刺激神经」。5 条通路的作用各有不同:交感神经(不含肾上腺)收缩血管升压;交感神经(心脏支)加快心率;交感神经(肾上腺支)释放肾上腺素,兼具升压与加快心率;肾神经影响尿量与血容量;迷走神经减慢心率、降低血压。"));
bodyChildren.push(...figure("s03-stimulus", "神经刺激卡片"));
bodyChildren.push(h2("4.4 快进与调速"));
bodyChildren.push(body("「快进 30 s」按钮可立即推近 30 生理秒,用于快速观察药物的慢速反应;速度下拉框可在 0.25×/1×/2×/5× 间切换走纸速度(默认 0.25× 为原版走纸节奏,时间轴始终为真实生理时间)。"));

// ---- 5 曲线与显示窗口 ----
bodyChildren.push(h1("五、曲线记录与显示窗口"));
bodyChildren.push(body("记录区自上而下为五个通道:ABP 动脉血压(mmHg)、LVP 左室内压(mmHg)、VBP 静脉血压(mmHg)、HF 心收缩力、HR 心率(bpm)。每条通道右侧标注当前数值,底部图例区分五条曲线颜色。"));
bodyChildren.push(h2("5.1 显示窗口"));
bodyChildren.push(body("「显示窗口」下拉框控制画面显示最近多长时间内的曲线,档位为 1.5 s/3 s/6 s/12 s/24 s/48 s/96 s/全部记录,默认 3 s。「×2」「÷2」按钮成倍缩放窗口;选择「全部记录」可回看整条实验曲线。"));
bodyChildren.push(h2("5.2 回看与测量"));
bodyChildren.push(body("当记录超过一屏后,底部出现回看滑块:拖动可查看任意历史时刻,点击「回到最新」恢复实时视图。点击曲线任意位置可放置绿色测量光标,读数显示在右下角;点击「测量工作表」可把光标读数加入表格(见第六章)。"));
bodyChildren.push(...figure("s05-window", "显示窗口、回看滑块与测量光标控件"));
bodyChildren.push(body("大屏显示器(视口宽度 1920 以上)会自动加大曲线区并压缩底部示意图,16:10 等高分屏下五通道曲线与时间轴可完整呈现在首屏。"));
bodyChildren.push(h2("5.3 区域框选均值"));
bodyChildren.push(body("在曲线上按住鼠标左键拖动画出一块时间范围,松开即出现半透明选区与均值面板(图 6):面板列出区间范围、样本数 n 与 ABP/LVP/VBP/HF/HR 五通道平均值,并提供「复制」(多行文本进剪贴板)与「加入工作表」(写入测量工作表,与光标取数行并存)两个按钮。单击曲线仍是绿色测量光标;单击空白或按 Esc 清除选区。"));
bodyChildren.push(...figure("s08b-region", "区域框选均值(拖动选区与五通道均值面板)"));

// ---- 6 教学工具 ----
bodyChildren.push(h1("六、教学工具"));
bodyChildren.push(h2("6.1 对比叠加"));
bodyChildren.push(body("点击「＋对比」可把当前显示窗口的曲线保存为半透明对比曲线,多次叠加便于给药前后对照。叠加的对比窗显示在按钮下方的列表中,可单独移除。"));
bodyChildren.push(h2("6.2 量效曲线工具"));
bodyChildren.push(body("点击「量效曲线」链接,软件按给药事件自动计算每次给药前后的血压/心率反应,生成量效关系表格与对数剂量散点图(图 7),并可导出 CSV 用于课堂分析。"));
bodyChildren.push(...figure("s07-dose", "量效曲线工具(表格与散点图)"));  // 图7
bodyChildren.push(h2("6.3 测量工作表"));
bodyChildren.push(body("打开「测量工作表」后,先在曲线上点击放置绿色光标,再点「加入光标读数」逐行记录时间与五通道数值(图 6);支持清空与导出 CSV,适合布置课堂测量作业。"));
bodyChildren.push(...figure("s08-worksheet", "测量工作表(光标取数,行尾可删)"));  // 图8

// ---- 7 授课广播 ----
bodyChildren.push(h1("七、授课广播(学生实时跟随)"));
bodyChildren.push(h2("7.1 开启广播"));
bodyChildren.push(body("点击右下角「开始授课广播」,软件即向全班开放实时跟随服务,并自动探测教学机局域网地址,在按钮上方显示学生访问地址(图 9)。每位教师一个房间号,多位教师同时开课互不干扰。"));
bodyChildren.push(...figure("s10-broadcast", "授课广播开启后的地址提示条"));
bodyChildren.push(body("提示条中的地址支持点击复制,复制后粘贴给全班即可;ⓘ 图标展开其他备用网卡地址(教室存在虚拟网卡时使用)。"));
bodyChildren.push(h2("7.2 学生跟随"));
bodyChildren.push(body("学生在同一 Wi-Fi 下用浏览器打开提示条中的地址(含房间号参数),即可实时观看教师端曲线,曲线与仿真时间以匀速走纸呈现,平滑流畅(图 10)。学生端同样可切换显示窗口与拖动回看;教师暂停时画面自然冻结,教师停止广播后学生端回到等待状态。"));
bodyChildren.push(...figure("s11-follow", "学生跟随页(浏览器打开)"));
bodyChildren.push(body("学生打开教师主页时,若检测到正在进行广播,页面会显示引导横幅,提示进入正确的跟随链接。"));
bodyChildren.push(h2("7.3 停止广播"));
bodyChildren.push(body("再次点击「停止授课广播」即可停止;停止后学生端回到「老师端尚未开始广播」的等待画面。教师直接关闭软件时,服务器会自动清理会话,不会让学生端长期停留在中断状态。"));

// ---- 8 数据管理 ----
bodyChildren.push(h1("八、数据管理:导出与导入"));
bodyChildren.push(body("点击「导出」下拉菜单(图 11)共有四种导出格式:"));
bodyChildren.push(...figure("s06-export", "导出菜单"));
bodyChildren.push(...numList([
  [bold("保存完整实验(JSON):"), plain("保存全部状态与曲线,可重新导入继续实验。")],
  [bold("导出波形数据(CSV):"), plain("五通道逐样本数据,便于 Excel/Origin 作图分析。")],
  [bold("导出当前曲线(PNG):"), plain("含坐标与事件标注的图片,可直接插入课件。")],
  [bold("导出原版记录文件(.rat):"), plain("与原版 RatCVS 软件的记录文件互通,导入导出均可。")],
]));
bodyChildren.push(body("「导入实验」可读取 JSON 文件继续计算,或读取 .rat 文件回看波形。软件每 20 秒自动保存当前实验,意外关闭后重新打开可自动恢复,无需手动保存。"));

// ---- 9 动物模型与死亡 ----
bodyChildren.push(h1("九、动物模型、死亡判定与实验设置"));
bodyChildren.push(h2("9.1 死亡判定"));
bodyChildren.push(body("以下情况判定大鼠死亡:动脉血压持续低于 20 mmHg 达 15 秒(如大剂量血管扩张药导致循环衰竭),或心室颤动导致射血停止(如地高辛中毒,图 12)。死亡后模型锁定,不能切换动物模型;曲线保留室颤波形,忠实还原真实实验所见。"));
bodyChildren.push(...figure("s12-death", "地高辛中毒导致的大鼠死亡(室颤波形)"));
bodyChildren.push(h2("9.2 原理与设置"));
bodyChildren.push(body("点击右上角「原理与设置」可调整(图 13):噪声开关(关闭后曲线变为理想化无噪声波形,便于讲解);死亡后曲线拉平开关(默认关闭,保持原版室颤表现);噪声种子(可记录并复现同一噪声序列,便于全班对照)。"));
bodyChildren.push(...figure("s09-settings", "原理与设置对话框"));
bodyChildren.push(body("「使用说明」按钮提供软件内的简要操作帮助。「查看循环药物」链接可查看当前血液中各药物的残留浓度,帮助理解药物的蓄积与消除。"));

// ---- 10 常见问题 ----
bodyChildren.push(h1("十、常见问题"));
bodyChildren.push(...numList([
  [bold("学生浏览器打不开跟随页?"), plain("确认学生与教学机在同一 Wi-Fi;确认地址完整(含 ?room= 房间号);首次开课时允许 Windows 防火墙访问;若教室有多个网卡,点提示条 ⓘ 换一个地址。")],
  [bold("跟随页显示「等待老师」?"), plain("教师尚未开始广播或已停止;教师重新开始广播后,等待页面会在约 2 秒内自动跟随,无需刷新。")],
  [bold("跟随页曲线不动?"), plain("教师端可能处于暂停;或教师端已停止广播。曲线与教师端以相同走纸速度匀速呈现,延迟通常在 1 秒以内。")],
  [bold("导出的文件在哪里?"), plain("桌面版导出时弹出保存对话框,由您选择位置;网页版直接写入浏览器默认下载目录。")],
  [bold("注射药物后血压没有变化?"), plain("低剂量药物反应可能较弱,点击「快进 30 s」观察;拮抗药起效需要时间;若注射的是未知药,请结合量效曲线工具分析。")],
  [bold("实验曲线出现异常抖动?"), plain("请确认学生端使用的是 v0.2.0 及以上版本;旧版本存在重复数据问题。")],
  [bold("框选均值时页面跟着滚动?"), plain("拖动前先把页面滚回顶部;框选操作在曲线区内横向拖动即可,选区完成后页面不再滚动。")],
]));
bodyChildren.push(new Paragraph({
  spacing: { before: 300, line: 312 },
  border: { top: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.innerLine, space: 8 } },
  children: [new TextRun({ text: "版本与致谢:本说明书对应 RatHeart-SimPro v0.2.0。软件中的心血管仿真模型基于 John Dempster(University of Strathclyde)的心血管教学模型实现,特此致谢。", size: 18, color: "707070" })],
}));

// ============================================================
// 文档组装
// ============================================================
const pageMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };
const doc = new Document({
  styles: { default: { document: {
    run: { font: { ascii: "Calibri", eastAsia: "SimSun" }, size: 24, color: "182030" },
    paragraph: { spacing: { line: 312 } },
  }}},
  numbering: { config: numberingConfig },
  features: { updateFields: true },
  sections: [
    // 封面
    {
      properties: { page: { margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: "RatHeart-SimPro 用户说明书",
        subtitle: "大鼠心血管实验模拟教学软件",
        englishLabel: "USER MANUAL",
        metaLines: ["软件版本:v0.2.0", "适用平台:Windows 10+ / macOS 12+ / Linux", "发布日期:2026 年 11 月"],
        footerLeft: "RatHeart-SimPro", footerRight: "v0.2.0",
        palette: { bg: PAL.bg, ...PAL.cover },
      }),
    },
    // 目录(无页码)
    {
      properties: { page: { margin: pageMargin } },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 },
          children: [new TextRun({ text: "目  录", bold: true, size: 32, color: PAL.primary, font: { eastAsia: "SimHei", ascii: "Arial" } })],
        }),
        new TableOfContents("目录", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({ text: "注:目录由域代码生成。编辑文档后请右键点击目录并选择「更新域」以刷新页码。", italics: true, size: 18, color: "888888" })],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },
    // 正文(页码从 1)
    {
      properties: { page: { margin: pageMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
      headers: { default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.innerLine, space: 4 } },
        children: [new TextRun({ text: "RatHeart-SimPro 用户说明书", size: 18, color: "8899AA" })],
      })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "707070" })],
      })] }) },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log("生成完成:", OUT, Math.round(buf.length / 1024), "KB,", figNo, "图");
});
