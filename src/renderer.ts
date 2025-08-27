import { CardCounts, nameToId, UNKNOWN_CARD } from "./collection";
import {
	CardData,
	getMultipleCardData,
	MAX_SCRYFALL_BATCH_SIZE,
	ScryfallResponse,
} from "./scryfall";
import { ObsidianPluginMtgSettings } from "./settings";
import { createDiv, createSpan } from "./dom-utils";
import { showMobileCardImage } from "./mobile-utils";

const DEFAULT_DECK_SECTION_NAME = "Deck:";
const DEFAULT_LIST_SECTION_NAME = "Cards:";
const COMMENT_DELIMITER = "#";

interface Line {
	lineType: "card" | "section" | "error" | "blank" | "comment" | "commander";
	cardCount?: number;
	globalCount?: number | null;
	cardName?: string;
	comments?: string[];
	errors?: string[];
	text?: string;
}

const lineMatchRE = /(\d+)x?\s(.*)/;
const setCodesRE = /(\([A-Za-z0-9]{3}\)\s\d+)/;
const lineWithSetCodes = /(\d+)x?\s+([\w| ,']*)\s+(\([A-Za-z0-9]{3}\)\s\d+)/;
const blankLineRE = /^\s+$/;
const headingMatchRE = new RegExp("^[^[0-9|" + COMMENT_DELIMITER + "]");

const currencyMapping = {
	usd: "$",
	eur: "€",
	tix: "Tx",
};

const idToNameMemo: Record<string, string> = {};

// Card type groups for organizing (Land comes last)
const CARD_TYPE_GROUPS = {
	Creature: ["Creature"],
	Instant: ["Instant"],
	Sorcery: ["Sorcery"],
	Artifact: ["Artifact"],
	Enchantment: ["Enchantment"],
	Planeswalker: ["Planeswalker"],
	Land: ["Land"],
	Battle: ["Battle"],
	Other: [],
};

export const getCardTypeGroup = (cardData?: CardData): string => {
	if (!cardData?.type_line) return "Other";

	const typeLine = cardData.type_line.toLowerCase();

	for (const [group, types] of Object.entries(CARD_TYPE_GROUPS)) {
		if (types.some((type) => typeLine.includes(type.toLowerCase()))) {
			return group;
		}
	}

	return "Other";
};

export const parseManaCost = (cardData?: CardData): number => {
	return cardData?.cmc || 0;
};

export const sortCardsByManaCost = (
	cards: Line[],
	cardDataById: Record<string, CardData>
): Line[] => {
	return cards.sort((a, b) => {
		if (
			(a.lineType !== "card" && a.lineType !== "commander") ||
			(b.lineType !== "card" && b.lineType !== "commander")
		)
			return 0;

		const aCardId = nameToId(a.cardName);
		const bCardId = nameToId(b.cardName);
		const aData = cardDataById[aCardId];
		const bData = cardDataById[bCardId];

		const aCmc = parseManaCost(aData);
		const bCmc = parseManaCost(bData);

		if (aCmc !== bCmc) return aCmc - bCmc;

		// If same CMC, sort alphabetically
		return (a.cardName || "").localeCompare(b.cardName || "");
	});
};

export const groupCardsByType = (
	cards: Line[],
	cardDataById: Record<string, CardData>
): Record<string, Line[]> => {
	const groups: Record<string, Line[]> = {};

	cards.forEach((card) => {
		if (card.lineType === "card" || card.lineType === "commander") {
			const cardId = nameToId(card.cardName);
			const cardData = cardDataById[cardId];
			const group = getCardTypeGroup(cardData);

			if (!groups[group]) {
				groups[group] = [];
			}
			groups[group].push(card);
		}
	});

	return groups;
};

export const getCardColorGroup = (cardData?: CardData): string => {
	// Check if it's a land first
	if (cardData?.type_line?.toLowerCase().includes("land")) {
		return "Lands";
	}

	if (!cardData?.color_identity || cardData.color_identity.length === 0) {
		return "Colorless";
	}

	const colors = cardData.color_identity.sort();

	// Single colors
	if (colors.length === 1) {
		switch (colors[0]) {
			case "W":
				return "White";
			case "U":
				return "Blue";
			case "B":
				return "Black";
			case "R":
				return "Red";
			case "G":
				return "Green";
			default:
				return "Colorless";
		}
	}

	// Two-color combinations (Guild names)
	if (colors.length === 2) {
		const combo = colors.join("");
		switch (combo) {
			case "UW":
				return "Azorius (W/U)";
			case "BW":
				return "Orzhov (W/B)";
			case "GW":
				return "Selesnya (W/G)";
			case "RW":
				return "Boros (W/R)";
			case "BU":
				return "Dimir (U/B)";
			case "GU":
				return "Simic (U/G)";
			case "RU":
				return "Izzet (U/R)";
			case "BG":
				return "Golgari (B/G)";
			case "BR":
				return "Rakdos (B/R)";
			case "GR":
				return "Gruul (R/G)";
			default:
				return "Multicolor";
		}
	}

	// Three-color combinations (Shard/Wedge names)
	if (colors.length === 3) {
		const combo = colors.join("");
		switch (combo) {
			case "GUW":
				return "Bant (G/W/U)";
			case "BUW":
				return "Esper (W/U/B)";
			case "BGR":
				return "Jund (B/R/G)";
			case "GRW":
				return "Naya (R/G/W)";
			case "BRU":
				return "Grixis (U/B/R)";
			case "BGW":
				return "Abzan (W/B/G)";
			case "GRU":
				return "Temur (G/U/R)";
			case "BRW":
				return "Mardu (R/W/B)";
			case "BGU":
				return "Sultai (B/G/U)";
			case "RUW":
				return "Jeskai (U/R/W)";
			default:
				return "Multicolor";
		}
	}

	// Four or five colors
	if (colors.length === 4) {
		return "Four-Color";
	}

	if (colors.length === 5) {
		return "Five-Color";
	}

	return "Multicolor";
};

export const groupCardsByColor = (
	cards: Line[],
	cardDataById: Record<string, CardData>
): Record<string, Line[]> => {
	const groups: Record<string, Line[]> = {};

	cards.forEach((card) => {
		if (card.lineType === "card" || card.lineType === "commander") {
			const cardId = nameToId(card.cardName);
			const cardData = cardDataById[cardId];
			const group = getCardColorGroup(cardData);

			if (!groups[group]) {
				groups[group] = [];
			}
			groups[group].push(card);
		}
	});

	return groups;
};

export const getColorCssClass = (sectionName: string): string | null => {
	// Handle prefixed section names (e.g., "Inventory - White")
	const colorName = sectionName.split(" - ").pop() || sectionName;

	if (colorName.includes("White")) return "mtg-color-white";
	if (
		colorName.includes("Blue") ||
		colorName.includes("Azorius") ||
		colorName.includes("Dimir") ||
		colorName.includes("Simic") ||
		colorName.includes("Izzet")
	)
		return "mtg-color-blue";
	if (
		colorName.includes("Black") ||
		colorName.includes("Orzhov") ||
		colorName.includes("Golgari") ||
		colorName.includes("Rakdos")
	)
		return "mtg-color-black";
	if (
		colorName.includes("Red") ||
		colorName.includes("Boros") ||
		colorName.includes("Gruul")
	)
		return "mtg-color-red";
	if (colorName.includes("Green") || colorName.includes("Selesnya"))
		return "mtg-color-green";
	if (colorName.includes("Colorless")) return "mtg-color-colorless";
	if (colorName.includes("Lands")) return "mtg-color-lands";
	if (
		colorName.includes("Bant") ||
		colorName.includes("Esper") ||
		colorName.includes("Jund") ||
		colorName.includes("Naya") ||
		colorName.includes("Grixis") ||
		colorName.includes("Abzan") ||
		colorName.includes("Temur") ||
		colorName.includes("Mardu") ||
		colorName.includes("Sultai") ||
		colorName.includes("Jeskai") ||
		colorName.includes("Four-Color") ||
		colorName.includes("Five-Color") ||
		colorName.includes("Multicolor")
	)
		return "mtg-color-multicolor";

	return null;
};

// Statistics and chart generation
interface DeckStatistics {
	manaCurve: Record<number, number>;
	typeDistribution: Record<string, number>;
	colorDistribution: Record<string, Record<number, number>>;
	totalCards: number;
}

interface ChartColors {
	textNormal: string;
	textMuted: string;
	interactiveAccent: string;
	interactiveAccentHover: string;
	backgroundPrimary: string;
	backgroundSecondary: string;
	backgroundModifierBorder: string;
}

export const getChartColors = (): ChartColors => {
	// Create a temporary element to get computed styles
	const tempEl = document.createElement("div");
	tempEl.style.position = "absolute";
	tempEl.style.visibility = "hidden";
	tempEl.style.pointerEvents = "none";
	document.body.appendChild(tempEl);

	const computedStyle = getComputedStyle(tempEl);

	// Get CSS custom properties
	const colors: ChartColors = {
		textNormal:
			getComputedStyle(document.documentElement)
				.getPropertyValue("--text-normal")
				.trim() || "#000000",
		textMuted:
			getComputedStyle(document.documentElement)
				.getPropertyValue("--text-muted")
				.trim() || "#666666",
		interactiveAccent:
			getComputedStyle(document.documentElement)
				.getPropertyValue("--interactive-accent")
				.trim() || "#007acc",
		interactiveAccentHover:
			getComputedStyle(document.documentElement)
				.getPropertyValue("--interactive-accent-hover")
				.trim() || "#1a8cdd",
		backgroundPrimary:
			getComputedStyle(document.documentElement)
				.getPropertyValue("--background-primary")
				.trim() || "#ffffff",
		backgroundSecondary:
			getComputedStyle(document.documentElement)
				.getPropertyValue("--background-secondary")
				.trim() || "#f5f5f5",
		backgroundModifierBorder:
			getComputedStyle(document.documentElement)
				.getPropertyValue("--background-modifier-border")
				.trim() || "#cccccc",
	};

	document.body.removeChild(tempEl);

	// Fallback colors if CSS vars are empty
	if (!colors.textNormal || colors.textNormal === "") {
		// Check if we're in dark mode
		const isDarkMode =
			document.body.classList.contains("theme-dark") ||
			window.matchMedia("(prefers-color-scheme: dark)").matches;

		if (isDarkMode) {
			colors.textNormal = "#dcddde";
			colors.textMuted = "#a3a3a3";
			colors.interactiveAccent = "#5865f2";
			colors.interactiveAccentHover = "#7289da";
			colors.backgroundPrimary = "#36393f";
			colors.backgroundSecondary = "#2f3136";
			colors.backgroundModifierBorder = "#4f545c";
		} else {
			colors.textNormal = "#2e3338";
			colors.textMuted = "#747f8d";
			colors.interactiveAccent = "#5865f2";
			colors.interactiveAccentHover = "#7289da";
			colors.backgroundPrimary = "#ffffff";
			colors.backgroundSecondary = "#f2f3f5";
			colors.backgroundModifierBorder = "#e3e5e8";
		}
	}

	return colors;
};

export const calculateDeckStatistics = (
	lines: Line[],
	cardDataById: Record<string, CardData>
): DeckStatistics => {
	const manaCurve: Record<number, number> = {};
	const typeDistribution: Record<string, number> = {};
	const colorDistribution: Record<string, Record<number, number>> = {
		W: {},
		U: {},
		B: {},
		R: {},
		G: {},
		C: {}, // White, Blue, Black, Red, Green, Colorless
	};
	let totalCards = 0;

	lines.forEach((line) => {
		// Exclude commanders from deck statistics (they're not part of the main deck)
		if (line.lineType === "card" && line.cardName && line.cardCount) {
			const cardId = nameToId(line.cardName);
			const cardData = cardDataById[cardId];
			const count = line.cardCount;

			totalCards += count;

			if (cardData) {
				const cardType = getCardTypeGroup(cardData);

				// Exclude lands from mana curve calculations
				if (cardType !== "Land") {
					const cmc = cardData.cmc || 0;
					const cmcKey = cmc >= 7 ? 7 : cmc; // Group 7+ together
					manaCurve[cmcKey] = (manaCurve[cmcKey] || 0) + count;
				}

				// Type distribution
				typeDistribution[cardType] =
					(typeDistribution[cardType] || 0) + count;

				// Color distribution by mana cost (exclude lands)
				if (cardType !== "Land") {
					const cmc = cardData.cmc || 0;
					const cmcKey = cmc >= 7 ? 7 : cmc;
					if (cardData.color_identity) {
						cardData.color_identity.forEach((color) => {
							if (!colorDistribution[color]) {
								colorDistribution[color] = {};
							}
							colorDistribution[color][cmcKey] =
								(colorDistribution[color][cmcKey] || 0) + count;
						});
					} else {
						// Colorless
						colorDistribution.C[cmcKey] =
							(colorDistribution.C[cmcKey] || 0) + count;
					}
				}
			}
		}
	});

	return {
		manaCurve,
		typeDistribution,
		colorDistribution,
		totalCards,
	};
};

export const createManaCurveChart = (
	canvas: HTMLCanvasElement,
	manaCurve: Record<number, number>
): void => {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const colors = getChartColors();
	const width = canvas.width;
	const height = canvas.height;
	const margin = 50;
	const chartWidth = width - 2 * margin;
	const chartHeight = height - 2 * margin;

	// Clear canvas with background color
	ctx.fillStyle = colors.backgroundPrimary;
	ctx.fillRect(0, 0, width, height);

	// Prepare data
	const maxCmc = 7;
	const maxCount = Math.max(...Object.values(manaCurve), 1);
	const barWidth = chartWidth / (maxCmc + 1);

	// Draw grid lines for better readability
	ctx.strokeStyle = colors.backgroundModifierBorder;
	ctx.lineWidth = 1;
	for (let i = 1; i <= maxCount; i++) {
		const y = margin + chartHeight - (i / maxCount) * chartHeight;
		ctx.beginPath();
		ctx.moveTo(margin, y);
		ctx.lineTo(margin + chartWidth, y);
		ctx.stroke();

		// Draw y-axis labels
		ctx.fillStyle = colors.textMuted;
		ctx.font = "10px Arial, sans-serif";
		ctx.textAlign = "right";
		ctx.fillText(i.toString(), margin - 8, y + 3);
	}

	// Create gradient for bars
	const gradient = ctx.createLinearGradient(
		0,
		margin,
		0,
		margin + chartHeight
	);
	gradient.addColorStop(0, colors.interactiveAccent);
	gradient.addColorStop(1, colors.interactiveAccentHover);

	// Draw bars with improved styling
	for (let cmc = 0; cmc <= maxCmc; cmc++) {
		const count = manaCurve[cmc] || 0;
		const barHeight = (count / maxCount) * chartHeight;
		const x = margin + cmc * barWidth + barWidth * 0.15;
		const y = margin + chartHeight - barHeight;
		const barWidthActual = barWidth * 0.7;

		// Draw bar with gradient and rounded top
		if (count > 0) {
			ctx.fillStyle = gradient;
			ctx.fillRect(x, y, barWidthActual, barHeight);

			// Add subtle border
			ctx.strokeStyle = colors.interactiveAccentHover;
			ctx.lineWidth = 1;
			ctx.strokeRect(x, y, barWidthActual, barHeight);
		}

		// Draw count labels with better positioning
		ctx.fillStyle = colors.textNormal;
		ctx.font = "bold 12px Arial, sans-serif";
		ctx.textAlign = "center";
		if (count > 0) {
			ctx.fillText(count.toString(), x + barWidthActual / 2, y - 8);
		}

		// Draw CMC labels with better styling
		ctx.fillStyle = colors.textNormal;
		ctx.font = "12px Arial, sans-serif";
		const label = cmc === 7 ? "7+" : cmc.toString();
		ctx.fillText(label, x + barWidthActual / 2, height - margin + 20);
	}

	// Draw axes
	ctx.strokeStyle = colors.textNormal;
	ctx.lineWidth = 2;
	ctx.beginPath();
	// Y-axis
	ctx.moveTo(margin, margin);
	ctx.lineTo(margin, margin + chartHeight);
	// X-axis
	ctx.lineTo(margin + chartWidth, margin + chartHeight);
	ctx.stroke();

	// Draw title
	ctx.fillStyle = colors.textNormal;
	ctx.font = "bold 16px Arial, sans-serif";
	ctx.textAlign = "center";
	ctx.fillText("Mana Curve (Excluding Lands)", width / 2, 25);

	// Draw axis labels
	ctx.font = "12px Arial, sans-serif";
	ctx.fillText("Mana Cost", width / 2, height - 10);

	// Y-axis label (rotated)
	ctx.save();
	ctx.translate(15, height / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.textAlign = "center";
	ctx.fillText("Number of Cards", 0, 0);
	ctx.restore();
};

export const createTypeDistributionChart = (
	canvas: HTMLCanvasElement,
	typeDistribution: Record<string, number>
): void => {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const themeColors = getChartColors();
	const width = canvas.width;
	const height = canvas.height;
	const pieRadius = Math.min(width * 0.3, height * 0.35);
	const pieX = width * 0.35;
	const pieY = height * 0.5;

	// Clear canvas with background color
	ctx.fillStyle = themeColors.backgroundPrimary;
	ctx.fillRect(0, 0, width, height);

	// Prepare data
	const total = Object.values(typeDistribution).reduce(
		(sum, count) => sum + count,
		0
	);
	if (total === 0) return;

	// More distinct colors for better visibility
	const sliceColors = [
		"#FF6B35", // Orange-red
		"#4285F4", // Blue
		"#34A853", // Green
		"#EA4335", // Red
		"#FBBC04", // Yellow
		"#9C27B0", // Purple
		"#FF9800", // Orange
		"#607D8B", // Blue-grey
	];
	let currentAngle = -Math.PI / 2; // Start at top
	let colorIndex = 0;

	// Draw pie slices
	Object.entries(typeDistribution).forEach(([type, count]) => {
		const percentage = count / total;
		const sliceAngle = percentage * 2 * Math.PI;

		ctx.beginPath();
		ctx.moveTo(pieX, pieY);
		ctx.arc(pieX, pieY, pieRadius, currentAngle, currentAngle + sliceAngle);
		ctx.closePath();
		ctx.fillStyle = sliceColors[colorIndex % sliceColors.length];
		ctx.fill();
		ctx.strokeStyle = themeColors.backgroundPrimary;
		ctx.lineWidth = 3;
		ctx.stroke();

		// Draw percentage labels on larger slices
		if (percentage > 0.08) {
			const labelAngle = currentAngle + sliceAngle / 2;
			const labelX = pieX + Math.cos(labelAngle) * (pieRadius * 0.75);
			const labelY = pieY + Math.sin(labelAngle) * (pieRadius * 0.75);

			ctx.fillStyle = themeColors.backgroundPrimary;
			ctx.font = "bold 11px Arial, sans-serif";
			ctx.textAlign = "center";
			ctx.fillText(`${count}`, labelX, labelY + 3);
		}

		currentAngle += sliceAngle;
		colorIndex++;
	});

	// Draw legend with better positioning
	const legendX = width * 0.65;
	const legendStartY = Math.max(
		40,
		pieY - Object.keys(typeDistribution).length * 9
	);
	colorIndex = 0;

	ctx.font = "12px Arial, sans-serif";
	ctx.textAlign = "left";

	Object.entries(typeDistribution).forEach(([type, count], index) => {
		const y = legendStartY + index * 20;

		// Draw color circle instead of square
		ctx.fillStyle = sliceColors[colorIndex % sliceColors.length];
		ctx.beginPath();
		ctx.arc(legendX + 8, y - 4, 6, 0, 2 * Math.PI);
		ctx.fill();

		// Draw text
		ctx.fillStyle = themeColors.textNormal;
		ctx.fillText(`${type}: ${count}`, legendX + 20, y);

		colorIndex++;
	});

	// Draw title
	ctx.fillStyle = themeColors.textNormal;
	ctx.font = "bold 16px Arial, sans-serif";
	ctx.textAlign = "center";
	ctx.fillText("Type Distribution", width / 2, 25);
};

export const createColorDistributionChart = (
	canvas: HTMLCanvasElement,
	colorDistribution: Record<string, Record<number, number>>
): void => {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const themeColors = getChartColors();
	const width = canvas.width;
	const height = canvas.height;
	const margin = 40;
	const chartWidth = width - 2 * margin - 100; // Leave space for legend
	const chartHeight = height - 2 * margin;

	// Clear canvas with background color
	ctx.fillStyle = themeColors.backgroundPrimary;
	ctx.fillRect(0, 0, width, height);

	// Color mapping
	const colorMap: Record<string, string> = {
		W: "#FFFBD5",
		U: "#0E68AB",
		B: "#150B00",
		R: "#D3202A",
		G: "#00733E",
		C: "#CCCC00",
	};

	// Prepare data
	const maxCmc = 7;
	let maxCount = 0;

	// Find max count for scaling
	Object.values(colorDistribution).forEach((colorData) => {
		Object.values(colorData).forEach((count) => {
			maxCount = Math.max(maxCount, count);
		});
	});

	if (maxCount === 0) return;

	const barWidth = chartWidth / (maxCmc + 1);
	const colors = Object.keys(colorMap).filter((color) => {
		return Object.values(colorDistribution[color] || {}).some(
			(count) => count > 0
		);
	});
	const colorBarWidth = barWidth / colors.length;

	// Draw stacked bars
	for (let cmc = 0; cmc <= maxCmc; cmc++) {
		colors.forEach((color, colorIndex) => {
			const count = colorDistribution[color]?.[cmc] || 0;
			if (count > 0) {
				const barHeight = (count / maxCount) * chartHeight;
				const x = margin + cmc * barWidth + colorIndex * colorBarWidth;
				const y = margin + chartHeight - barHeight;

				ctx.fillStyle = colorMap[color];
				ctx.fillRect(x, y, colorBarWidth * 0.9, barHeight);

				// Add stroke for better visibility
				ctx.strokeStyle = themeColors.backgroundModifierBorder;
				ctx.lineWidth = 1;
				ctx.strokeRect(x, y, colorBarWidth * 0.9, barHeight);
			}
		});

		// Draw CMC labels
		ctx.fillStyle = themeColors.textNormal;
		ctx.font = "10px Arial, sans-serif";
		ctx.textAlign = "center";
		const label = cmc === 7 ? "7+" : cmc.toString();
		ctx.fillText(
			label,
			margin + cmc * barWidth + barWidth / 2,
			height - margin + 15
		);
	}

	// Draw legend
	const legendX = width - 90;
	const legendY = 50;

	ctx.font = "11px Arial, sans-serif";
	ctx.textAlign = "left";

	colors.forEach((color, index) => {
		const y = legendY + index * 20;

		// Draw color box
		ctx.fillStyle = colorMap[color];
		ctx.fillRect(legendX, y - 10, 12, 12);
		ctx.strokeStyle = themeColors.backgroundModifierBorder;
		ctx.lineWidth = 1;
		ctx.strokeRect(legendX, y - 10, 12, 12);

		// Draw text
		ctx.fillStyle = themeColors.textNormal;
		const colorName =
			{
				W: "White",
				U: "Blue",
				B: "Black",
				R: "Red",
				G: "Green",
				C: "Colorless",
			}[color] || color;
		ctx.fillText(colorName, legendX + 16, y);
	});

	// Draw title
	ctx.fillStyle = themeColors.textNormal;
	ctx.font = "bold 14px Arial, sans-serif";
	ctx.textAlign = "center";
	ctx.fillText("Color Distribution by Mana Cost", width / 2, 20);
};

export const createStatisticsSection = (
	containerEl: Element,
	lines: Line[],
	cardDataById: Record<string, CardData>,
	settings: ObsidianPluginMtgSettings
): HTMLElement => {
	if (!settings.decklist.showStatistics) {
		return document.createElement("div");
	}

	const statistics = calculateDeckStatistics(lines, cardDataById);

	const statsContainer = createDiv(containerEl, {
		cls: "mtg-statistics-container",
	});

	const statsHeader = document.createElement("h3");
	statsHeader.textContent = "Deck Statistics";
	statsHeader.classList.add("mtg-statistics-header");
	statsContainer.appendChild(statsHeader);

	const chartsContainer = createDiv(statsContainer, {
		cls: "mtg-charts-container",
	});

	// Mana Curve Chart
	if (settings.decklist.showManaCurveChart) {
		const manaCurveContainer = createDiv(chartsContainer, {
			cls: "mtg-chart-container",
		});

		const manaCurveCanvas = document.createElement("canvas");
		manaCurveCanvas.width = 400;
		manaCurveCanvas.height = 250;
		manaCurveCanvas.classList.add("mtg-chart-canvas");
		manaCurveContainer.appendChild(manaCurveCanvas);

		// Use setTimeout to ensure canvas is in DOM
		setTimeout(
			() => createManaCurveChart(manaCurveCanvas, statistics.manaCurve),
			0
		);
	}

	// Type Distribution Chart
	if (settings.decklist.showTypeDistributionChart) {
		const typeDistContainer = createDiv(chartsContainer, {
			cls: "mtg-chart-container",
		});

		const typeDistCanvas = document.createElement("canvas");
		typeDistCanvas.width = 400;
		typeDistCanvas.height = 250;
		typeDistCanvas.classList.add("mtg-chart-canvas");
		typeDistContainer.appendChild(typeDistCanvas);

		setTimeout(
			() =>
				createTypeDistributionChart(
					typeDistCanvas,
					statistics.typeDistribution
				),
			0
		);
	}

	// Color Distribution Chart
	if (settings.decklist.showColorDistributionChart) {
		const colorDistContainer = createDiv(chartsContainer, {
			cls: "mtg-chart-container",
		});

		const colorDistCanvas = document.createElement("canvas");
		colorDistCanvas.width = 500;
		colorDistCanvas.height = 250;
		colorDistCanvas.classList.add("mtg-chart-canvas");
		colorDistContainer.appendChild(colorDistCanvas);

		setTimeout(
			() =>
				createColorDistributionChart(
					colorDistCanvas,
					statistics.colorDistribution
				),
			0
		);
	}

	return statsContainer;
};

export const createAdvancedControls = (
	headerEl: Element,
	decklistContainer: Element,
	settings: ObsidianPluginMtgSettings
): HTMLElement => {
	if (
		!settings.decklist.enableAdvancedFeatures ||
		!settings.decklist.showSearchFilter
	) {
		return document.createElement("div");
	}

	const controlsContainer = createDiv(headerEl, {
		cls: "mtg-advanced-controls",
	});

	const searchContainer = createDiv(controlsContainer, {
		cls: "mtg-search-container",
	});

	const searchInput = document.createElement("input");
	searchInput.type = "text";
	searchInput.placeholder = "Search cards...";
	searchInput.classList.add("mtg-search-input");

	searchContainer.appendChild(searchInput);

	// Add event listener for real-time filtering
	searchInput.addEventListener("input", (e) => {
		const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
		const cardRows = decklistContainer.querySelectorAll(
			".decklist__section-list-item"
		);

		cardRows.forEach((row) => {
			const cardNameElement = row.querySelector(".card-name");
			if (cardNameElement) {
				const cardName =
					cardNameElement.textContent?.toLowerCase() || "";
				const shouldShow =
					searchTerm === "" || cardName.includes(searchTerm);
				(row as HTMLElement).style.display = shouldShow
					? "flex"
					: "none";
			}
		});
	});

	return controlsContainer;
};

export const getCardPrice = (
	cardName: string,
	cardDataById: Record<string, CardData>,
	settings: ObsidianPluginMtgSettings,
	isGenericList = false
) => {
	const cardId = nameToId(cardName);
	const cardData = cardDataById[cardId];
	const preferredCurrency = settings.decklist.preferredCurrency;
	const hidePrices = settings.decklist.hidePrices;
	const mobileMode = settings.decklist.mobileMode;

	// Hide prices if explicitly disabled or in mobile mode (but only for decklists, not generic lists)
	if (!cardData || hidePrices || (mobileMode && !isGenericList)) {
		return null;
	} else {
		if (preferredCurrency === "eur") {
			return cardData.prices?.eur || null;
		} else if (preferredCurrency === "tix") {
			return cardData.prices?.tix || null;
		} else {
			return cardData.prices?.usd || null;
		}
	}
};

export const exportCardImages = async (
	lines: Line[],
	cardDataById: Record<string, CardData>,
	settings: ObsidianPluginMtgSettings
): Promise<void> => {
	// Filter to only card lines with valid card data
	const cardLines = lines.filter(
		(line) =>
			line.lineType === "card" &&
			line.cardName &&
			cardDataById[nameToId(line.cardName)]
	);

	if (cardLines.length === 0) {
		console.warn("No cards with image data found for export");
		return;
	}

	// Create HTML content for export
	let htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>MTG Card Images Export</title>
	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 20px;
			background-color: #f5f5f5;
		}
		.header {
			text-align: center;
			margin-bottom: 30px;
			color: #333;
		}
		.cards-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
			gap: 20px;
			max-width: 1200px;
			margin: 0 auto;
		}
		.card-item {
			background: white;
			border-radius: 12px;
			padding: 15px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.1);
			text-align: center;
		}
		.card-image {
			width: 100%;
			max-width: 200px;
			height: auto;
			border-radius: 8px;
			margin-bottom: 10px;
		}
		.card-info {
			margin-top: 10px;
		}
		.card-name {
			font-weight: bold;
			font-size: 14px;
			margin-bottom: 5px;
			color: #333;
		}
		.card-details {
			font-size: 12px;
			color: #666;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		.card-count {
			font-weight: 500;
		}
		.card-price {
			font-weight: 500;
			color: #2e7d32;
		}
		@media print {
			body { background-color: white; }
			.card-item { break-inside: avoid; }
		}
	</style>
</head>
<body>
	<div class="header">
		<h1>MTG Card Images</h1>
		<p>Exported on ${new Date().toLocaleDateString()}</p>
	</div>
	<div class="cards-grid">
`;

	// Add each card to the HTML
	for (const line of cardLines) {
		if (!line.cardName) continue;

		const cardId = nameToId(line.cardName);
		const cardData = cardDataById[cardId];
		if (!cardData) continue;

		// Get card image URL
		let imageUrl = "";
		if (cardData.image_uris?.large) {
			imageUrl = cardData.image_uris.large;
		} else if (
			cardData.card_faces &&
			cardData.card_faces[0]?.image_uris?.large
		) {
			imageUrl = cardData.card_faces[0].image_uris.large;
		}

		if (!imageUrl) continue;

		// Get card price
		const cardPrice = getCardPrice(
			line.cardName,
			cardDataById,
			settings,
			true
		);
		const priceDisplay = cardPrice
			? `${currencyMapping[settings.decklist.preferredCurrency]}${(
					parseFloat(cardPrice) * (line.cardCount || 1)
			  ).toFixed(2)}`
			: "";

		htmlContent += `
		<div class="card-item">
			<img src="${imageUrl}" alt="${cardData.name}" class="card-image" loading="lazy">
			<div class="card-info">
				<div class="card-name">${cardData.name}</div>
				<div class="card-details">
					<span class="card-count">${line.cardCount}x</span>
					${priceDisplay ? `<span class="card-price">${priceDisplay}</span>` : ""}
				</div>
			</div>
		</div>
`;
	}

	htmlContent += `
	</div>
</body>
</html>
`;

	// Create and download the HTML file
	const blob = new Blob([htmlContent], { type: "text/html" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `mtg-cards-export-${new Date()
		.toISOString()
		.slice(0, 10)}.html`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
};

export const createExportButton = (
	headerEl: Element,
	lines: Line[],
	cardDataById: Record<string, CardData>,
	settings: ObsidianPluginMtgSettings
): HTMLElement => {
	const exportContainer = createDiv(headerEl, {
		cls: "mtg-export-container",
	});

	const exportButton = document.createElement("button");
	exportButton.textContent = "Export Images";
	exportButton.classList.add("mtg-export-button");
	exportButton.title = "Export card images as HTML file";

	exportButton.addEventListener("click", async () => {
		exportButton.disabled = true;
		exportButton.textContent = "Exporting...";

		try {
			await exportCardImages(lines, cardDataById, settings);
		} catch (error) {
			console.error("Export failed:", error);
		} finally {
			exportButton.disabled = false;
			exportButton.textContent = "Export Images";
		}
	});

	exportContainer.appendChild(exportButton);
	return exportContainer;
};

export const parseLines = (
	rawLines: string[],
	cardCounts: CardCounts
): Line[] => {
	// This means global counts are not available because they are missing or no collection files are present
	let shouldSkipGlobalCounts = !Object.keys(cardCounts).length;

	// count, collection_count, card name, comment
	return rawLines.map((line) => {
		// Handle blank lines
		if (!line.length || line.match(blankLineRE)) {
			return {
				lineType: "blank",
			};
		}

		// Handle headings
		if (line.match(headingMatchRE)) {
			return {
				lineType: "section",
				text: line,
			};
		}

		// Handle comment lines
		if (line.startsWith(COMMENT_DELIMITER + " ")) {
			return {
				lineType: "comment",
				comments: [line],
			};
		}

		// Handle commander lines (1x card name with *CMDR* marker)
		if (line.includes("*CMDR*")) {
			const commanderLine = line.replace("*CMDR*", "").trim();
			let lineParts = commanderLine.match(lineMatchRE);

			if (lineParts) {
				const cardName: string = lineParts[2];
				const cardId: string = nameToId(cardName);
				let globalCount = null;

				if (!shouldSkipGlobalCounts) {
					globalCount = cardCounts[cardId] || 0;
				}

				return {
					lineType: "commander",
					cardCount: 1,
					globalCount,
					cardName,
					comments: [],
					errors: [],
				};
			}
		}

		let lineWithoutComments: string = line;
		const comments: string[] = [];
		// Handle setcodes, etc
		if (lineWithoutComments.match(lineWithSetCodes)) {
			lineWithoutComments = lineWithoutComments
				.replace(setCodesRE, "")
				.trim();
		}

		// Handle comments
		if (line.includes(COMMENT_DELIMITER)) {
			const lineAndComments = line.split(COMMENT_DELIMITER);
			lineAndComments
				.slice(1)
				.forEach((comment) => comments.push(comment));
			lineWithoutComments = lineAndComments[0];
		}

		// Handle card lines
		let lineParts = lineWithoutComments.match(lineMatchRE);

		// Handle invalid line
		if (lineParts == null) {
			return {
				lineType: "error",
				errors: [`invalid line: ${line}`],
			};
		} else {
			const cardCount: number = parseInt(lineParts[1] || "0");
			const cardName: string = lineParts[2];
			const cardId: string = nameToId(cardName);
			const errors: string[] = [];

			let globalCount = null;

			if (!shouldSkipGlobalCounts) {
				globalCount = cardCounts[cardId] || 0;
			}

			if (cardName.length === 0) {
				errors.push(`Unable to parse card name from: ${line}`);
			}

			return {
				lineType: "card",
				cardCount,
				globalCount,
				cardName,
				comments,
				errors,
			};
		}
	});
};

export const buildDistinctCardNamesList = (lines: Line[]): string[] => {
	return Array.from(
		new Set(
			lines
				.map((line) => line.cardName || "")
				// Remove missing values
				.filter((line) => line !== "")
		)
	);
};

export const fetchCardDataFromScryfall = async (
	distinctCardNames: string[]
): Promise<Record<string, CardData>> => {
	// Fetch in batches of 75, since that's the limit of Scryfall batch sizes
	const batches: string[][] = [];
	let currentBatch: string[] = [];
	batches.push(currentBatch);
	distinctCardNames.forEach((cardName: string, idx: number) => {
		if (currentBatch.length === MAX_SCRYFALL_BATCH_SIZE) {
			batches.push(currentBatch);
			// Make new batch
			currentBatch = [];
		}
		currentBatch.push(nameToId(cardName));
	});
	// Add remaining cards
	batches.push(currentBatch);

	const cardDataInBatches: ScryfallResponse[] = await Promise.all(
		batches.map((batch) => getMultipleCardData(batch))
	);
	const cardDataByCardId: Record<string, CardData> = {};
	const cards = [];

	cardDataInBatches.forEach((batch) => {
		batch.data.forEach((card: CardData) => {
			cards.push(card);
			if (card.name) {
				const cardId = nameToId(card.name);
				cardDataByCardId[cardId] = card;
			}
		});
	});

	return cardDataByCardId;
};

export const renderDecklist = async (
	root: Element,
	source: string,
	cardCounts: CardCounts,
	settings: ObsidianPluginMtgSettings,
	dataFetcher = fetchCardDataFromScryfall,
	isGenericList = false
): Promise<Element> => {
	const containerEl = createDiv(root, {});
	containerEl.classList.add(isGenericList ? "mtg-list" : "decklist");

	const lines: string[] = source.split("\n");

	const parsedLines: Line[] = parseLines(lines, cardCounts);

	let linesBySection: Record<string, Line[]> = {};

	const defaultSectionName = isGenericList
		? DEFAULT_LIST_SECTION_NAME
		: DEFAULT_DECK_SECTION_NAME;
	let currentSection = defaultSectionName;
	let sections: string[] = [];

	// A reverse mapping for getting names from an id
	const idsToNames: Record<string, string> = {};

	parsedLines.forEach((line, idx) => {
		if (idx == 0 && line.lineType !== "section") {
			currentSection = `${currentSection}`;
			sections.push(`${currentSection}`);
		}
		if (line.lineType === "section") {
			currentSection = line.text || defaultSectionName;
			sections.push(`${currentSection}`);
		} else {
			if (!linesBySection[currentSection]) {
				linesBySection[currentSection] = [];
			}
			linesBySection[currentSection].push(line);
		}
	});

	// Create list of distinct card names
	const distinctCardNames: string[] = buildDistinctCardNamesList(parsedLines);
	let cardDataByCardId: Record<string, CardData> = {};

	// Try to fetch data from Scryfall
	try {
		cardDataByCardId = await dataFetcher(distinctCardNames);
	} catch (err) {
		console.log("Error fetching card data: ", err);
	}

	// Determines whether any card info was found for the cards on the list
	const hasCardInfo = Object.keys(cardDataByCardId).length > 0;

	// Extract commanders and create a separate section
	if (!isGenericList) {
		const commanderLines: Line[] = [];
		const newLinesBySection: Record<string, Line[]> = {};

		// First, extract all commanders from all sections
		sections.forEach((sectionName) => {
			const commanders = linesBySection[sectionName].filter(
				(line) => line.lineType === "commander"
			);
			const nonCommanders = linesBySection[sectionName].filter(
				(line) => line.lineType !== "commander"
			);

			commanderLines.push(...commanders);
			newLinesBySection[sectionName] = nonCommanders;
		});

		// Add commander section if there are commanders
		if (commanderLines.length > 0) {
			newLinesBySection["Commander"] = commanderLines;
			sections.unshift("Commander"); // Add to beginning
		}

		linesBySection = newLinesBySection;
	}

	// Apply color grouping for mtg-list (generic lists)
	if (isGenericList) {
		// Reorganize sections by card color
		const newLinesBySection: Record<string, Line[]> = {};

		sections.forEach((sectionName) => {
			const sectionCards = linesBySection[sectionName].filter(
				(line) => line.lineType === "card"
			);
			const sectionComments = linesBySection[sectionName].filter(
				(line) => line.lineType === "comment"
			);

			if (sectionCards.length > 0) {
				const cardGroups = groupCardsByColor(
					sectionCards,
					cardDataByCardId
				);

				// Sort each group alphabetically
				Object.keys(cardGroups).forEach((groupName) => {
					cardGroups[groupName] = cardGroups[groupName].sort((a, b) =>
						(a.cardName || "").localeCompare(b.cardName || "")
					);

					// Create new section for each color group
					const newSectionName =
						sectionName === defaultSectionName
							? groupName
							: `${sectionName} - ${groupName}`;
					newLinesBySection[newSectionName] = cardGroups[groupName];
				});
			}

			// Add comments to a separate section if they exist
			if (sectionComments.length > 0) {
				const commentSectionName =
					sectionName === defaultSectionName
						? "Comments"
						: `${sectionName} - Comments`;
				newLinesBySection[commentSectionName] = sectionComments;
			}
		});

		linesBySection = newLinesBySection;

		// Order sections by color priority (WUBRG + multicolor + colorless + lands)
		const colorOrder = [
			"White",
			"Blue",
			"Black",
			"Red",
			"Green",
			"Azorius (W/U)",
			"Orzhov (W/B)",
			"Selesnya (W/G)",
			"Boros (W/R)",
			"Dimir (U/B)",
			"Simic (U/G)",
			"Izzet (U/R)",
			"Golgari (B/G)",
			"Rakdos (B/R)",
			"Gruul (R/G)",
			"Bant (G/W/U)",
			"Esper (W/U/B)",
			"Jund (B/R/G)",
			"Naya (R/G/W)",
			"Grixis (U/B/R)",
			"Abzan (W/B/G)",
			"Temur (G/U/R)",
			"Mardu (R/W/B)",
			"Sultai (B/G/U)",
			"Jeskai (U/R/W)",
			"Four-Color",
			"Five-Color",
			"Multicolor",
			"Colorless",
			"Lands",
			"Comments",
		];

		const orderedSections: string[] = [];

		colorOrder.forEach((colorName) => {
			// Check for exact color name match
			if (linesBySection[colorName]) {
				orderedSections.push(colorName);
			}

			// Check for prefixed color names (e.g., "Inventory - White")
			Object.keys(linesBySection).forEach((sectionName) => {
				if (
					sectionName.includes(colorName) &&
					sectionName !== colorName &&
					!orderedSections.includes(sectionName)
				) {
					orderedSections.push(sectionName);
				}
			});
		});

		// Add any remaining sections that don't match the pattern
		Object.keys(linesBySection).forEach((sectionName) => {
			if (!orderedSections.includes(sectionName)) {
				orderedSections.push(sectionName);
			}
		});

		sections = orderedSections;
	}
	// Apply type grouping if enabled or in mobile mode for better organization (for decklists only)
	else if (
		!isGenericList &&
		((settings.decklist.enableAdvancedFeatures &&
			settings.decklist.groupByType) ||
			settings.decklist.mobileMode)
	) {
		// Reorganize sections by card type
		const newLinesBySection: Record<string, Line[]> = {};

		sections.forEach((sectionName) => {
			// Skip commander section from type grouping
			if (sectionName === "Commander") {
				newLinesBySection[sectionName] = linesBySection[sectionName];
				return;
			}

			const sectionCards = linesBySection[sectionName].filter(
				(line) => line.lineType === "card"
			);
			const sectionComments = linesBySection[sectionName].filter(
				(line) => line.lineType === "comment"
			);

			if (sectionCards.length > 0) {
				const cardGroups = groupCardsByType(
					sectionCards,
					cardDataByCardId
				);

				// Sort each group by mana cost if enabled or in mobile mode
				Object.keys(cardGroups).forEach((groupName) => {
					if (
						settings.decklist.sortByManaCost ||
						settings.decklist.mobileMode
					) {
						cardGroups[groupName] = sortCardsByManaCost(
							cardGroups[groupName],
							cardDataByCardId
						);
					}

					// Create new section for each card type
					const newSectionName =
						sectionName === defaultSectionName
							? groupName
							: `${sectionName} - ${groupName}`;
					newLinesBySection[newSectionName] = cardGroups[groupName];
				});
			}

			// Add comments to a separate section if they exist
			if (sectionComments.length > 0) {
				const commentSectionName =
					sectionName === defaultSectionName
						? "Comments"
						: `${sectionName} - Comments`;
				newLinesBySection[commentSectionName] = sectionComments;
			}
		});

		linesBySection = newLinesBySection;

		// Order sections according to CARD_TYPE_GROUPS order
		const orderedSections: string[] = [];

		// First add commander section if it exists
		if (linesBySection["Commander"]) {
			orderedSections.push("Commander");
		}

		// Then add sections in the order defined by CARD_TYPE_GROUPS
		Object.keys(CARD_TYPE_GROUPS).forEach((groupName) => {
			// Check for exact group name match
			if (linesBySection[groupName]) {
				orderedSections.push(groupName);
			}

			// Check for prefixed group names (e.g., "Main - Creature")
			Object.keys(linesBySection).forEach((sectionName) => {
				if (
					sectionName.includes(groupName) &&
					sectionName !== groupName &&
					!orderedSections.includes(sectionName)
				) {
					orderedSections.push(sectionName);
				}
			});
		});

		// Add any remaining sections that don't match the pattern
		Object.keys(linesBySection).forEach((sectionName) => {
			if (!orderedSections.includes(sectionName)) {
				orderedSections.push(sectionName);
			}
		});

		sections = orderedSections;
	} else if (
		(settings.decklist.sortByManaCost || settings.decklist.mobileMode) &&
		!isGenericList
	) {
		// Just sort by mana cost within existing sections
		sections.forEach((sectionName) => {
			const sectionCards = linesBySection[sectionName].filter(
				(line) => line.lineType === "card"
			);
			const otherLines = linesBySection[sectionName].filter(
				(line) => line.lineType !== "card"
			);

			if (sectionCards.length > 0) {
				const sortedCards = sortCardsByManaCost(
					sectionCards,
					cardDataByCardId
				);
				linesBySection[sectionName] = [...sortedCards, ...otherLines];
			}
		});
	}

	// Make elements from parsedLines
	const sectionContainers: Element[] = [];

	// Header section
	const header = createDiv(containerEl, {
		cls: settings.decklist.mobileMode ? "header mobile-header" : "header",
	});

	// Add advanced controls
	if (!isGenericList) {
		createAdvancedControls(header, containerEl, settings);
	}

	const imgElContainer = document.createElement("div");
	imgElContainer.classList.add("card-image-container");
	const imgEl = document.createElement("img");
	imgEl.classList.add("card-image");
	imgElContainer.appendChild(imgEl);

	// Attach image container to header
	header.appendChild(imgElContainer);

	// Footer Section
	const footer = document.createElement("div");
	footer.classList.add("footer");

	const sectionTotalCounts: Record<string, number> = sections.reduce(
		(acc, curr) => ({ ...acc, [curr]: 0 }),
		{}
	);
	const sectionTotalCost: Record<string, number> = sections.reduce(
		(acc, curr) => ({ ...acc, [curr]: 0.0 }),
		{}
	);
	const missingCardCounts: CardCounts = {};

	sections.forEach((section: string) => {
		// Put the entire deck in containing div for styling
		const sectionContainer = document.createElement("div");
		sectionContainer.classList.add("decklist__section-container");
		if (settings.decklist.mobileMode) {
			sectionContainer.classList.add("mobile-section");
		}

		// Create a heading
		const sectionHedingEl = document.createElement("h3");
		sectionHedingEl.classList.add("decklist__section-heading");

		// Add color-specific CSS classes for mtg-list
		if (isGenericList) {
			const colorClass = getColorCssClass(section);
			if (colorClass) {
				sectionHedingEl.classList.add(colorClass);
			}
		}

		sectionContainer.appendChild(sectionHedingEl);

		// Create container for the list items
		const sectionList = document.createElement("ul");
		sectionList.classList.add("decklist__section-list");

		const sectionMissingCardCounts: CardCounts = {};

		// Create line item elements
		linesBySection[section].forEach((line: Line) => {
			const lineEl = document.createElement("li");
			lineEl.classList.add("decklist__section-list-item");
			if (settings.decklist.mobileMode) {
				lineEl.classList.add("mobile-card-item");
			}

			// Add special styling for commanders
			if (line.lineType === "commander") {
				lineEl.classList.add("commander-card");
			}

			if (line.lineType === "commander") {
				// Commanders are handled at section level, skip individual rendering
				// They will be displayed as the section heading
			} else if (line.lineType === "card") {
				const cardCountEl = createSpan(lineEl, {
					cls: "count",
				});

				const cardNameEl = createSpan(lineEl, {
					cls: "card-name",
				});

				// Add hyperlink when possible
				if (line.cardName) {
					const cardId = nameToId(line.cardName);
					const cardInfo = cardDataByCardId[cardId];
					if (
						settings.decklist.showCardNamesAsHyperlinks &&
						cardInfo &&
						cardInfo.scryfall_uri
					) {
						const cardLinkEl = document.createElement("a");
						const purchaseUri = cardInfo.scryfall_uri;
						cardLinkEl.href = purchaseUri;
						cardLinkEl.textContent = `${cardInfo.name}`;
						cardNameEl.appendChild(cardLinkEl);
					} else {
						cardNameEl.textContent = `${
							(cardInfo && cardInfo.name) ||
							line.cardName ||
							UNKNOWN_CARD
						}`;
					}
				}

				let cardErrorsEl = null;
				if (line.errors && line.errors.length) {
					cardErrorsEl = createSpan(lineEl, {
						cls: "error",
						text: line.errors?.join(",") || "",
					});
				}

				const cardCommentsEl = createSpan(lineEl, {
					cls: "comment",
					text: line.comments?.join("#") || "",
				});

				const cardPriceEl = createSpan(lineEl, {
					cls: "card-price",
				});
				let cardPrice;
				if (line.cardName) {
					cardPrice = getCardPrice(
						line.cardName,
						cardDataByCardId,
						settings,
						isGenericList
					);
				}

				const lineCardCount = line.cardCount || 0;
				const lineGlobalCount =
					line.globalCount === null ? -1 : line.globalCount || 0;

				// Show missing card counts
				if (lineGlobalCount !== -1 && lineCardCount > lineGlobalCount) {
					const counts = createSpan(cardCountEl);
					// Card error element
					createSpan(counts, {
						cls: "error",
						text: `${lineGlobalCount}`,
					});
					// Card counts row element
					createSpan(counts, {
						text: ` / ${lineCardCount}`,
					});
					lineEl.classList.add("insufficient-count");

					const cardId = nameToId(line.cardName);
					missingCardCounts[cardId] =
						(missingCardCounts[cardId] || 0) +
						(lineCardCount - lineGlobalCount);

					sectionMissingCardCounts[cardId] =
						(sectionMissingCardCounts[cardId] || 0) +
						(lineCardCount - lineGlobalCount);

					if (cardPrice) {
						cardPriceEl.classList.add("insufficient-count");

						const totalPrice: number =
							lineCardCount * parseFloat(cardPrice);
						const amountOwned: number =
							lineGlobalCount * parseFloat(cardPrice);

						const amountOwnedEl = createSpan(cardPriceEl, {
							cls: "error",
							text: `${
								currencyMapping[
									settings.decklist.preferredCurrency
								]
							}${amountOwned.toFixed(2)}`,
						});

						// totalPriceEl
						createSpan(cardPriceEl, {
							text: ` / ${
								currencyMapping[
									settings.decklist.preferredCurrency
								]
							}${totalPrice.toFixed(2)}`,
						});

						// Add cost to total
						sectionTotalCost[section] =
							sectionTotalCost[section] + (totalPrice || 0.0);
					}
				} else {
					cardCountEl.textContent = `${lineCardCount}`;

					if (cardPrice) {
						const totalPrice: number =
							lineCardCount * parseFloat(cardPrice);
						const displayPrice = `${
							currencyMapping[settings.decklist.preferredCurrency]
						}${totalPrice.toFixed(2)}`;
						cardPriceEl.textContent = displayPrice;

						// Add cost to total
						sectionTotalCost[section] =
							sectionTotalCost[section] + (totalPrice || 0.0);
					}
				}

				sectionTotalCounts[section] =
					sectionTotalCounts[section] + (line.cardCount || 0);

				if (cardErrorsEl) {
					lineEl.appendChild(cardErrorsEl);
				}

				if (settings.decklist.showCardPreviews) {
					const cardId = nameToId(line.cardName);
					const cardInfo = cardDataByCardId[cardId];
					let imgUri: string | undefined;

					if (cardInfo) {
						// For single-faced cards...
						if (cardInfo.image_uris) {
							imgUri = cardInfo.image_uris?.large;
							// For double-faced cards...
						} else if (
							cardInfo.card_faces &&
							cardInfo.card_faces.length > 1
						) {
							// Use the front-side of the card for preview
							imgUri = cardInfo.card_faces[0].image_uris?.large;
						}
					}

					if (settings.decklist.mobileMode) {
						// Mobile: use click to show centered overlay
						if (imgUri) {
							lineEl.style.cursor = "pointer";
							lineEl.addEventListener("click", (e) => {
								e.preventDefault();
								e.stopPropagation();
								showMobileCardImage(imgUri!);
							});
						}
					} else {
						// Desktop: use hover as before
						lineEl.addEventListener("mouseenter", () => {
							if (imgUri) {
								// Calculate positioning with bounds checking
								const offsetPaddingTop = 16;
								const imageHeight = 400; // matches .card-image height in CSS
								const containerRect =
									containerEl.getBoundingClientRect();
								const lineRect = lineEl.getBoundingClientRect();

								// Calculate initial top position
								let topPosition =
									lineEl.offsetTop + offsetPaddingTop;

								// Check if image would extend beyond container bottom
								if (
									topPosition + imageHeight >
									containerEl.scrollHeight
								) {
									// Position above the line instead, with some padding
									topPosition = Math.max(
										0,
										lineEl.offsetTop -
											imageHeight -
											offsetPaddingTop
									);
								}

								// Set position with buffer to prevent hover interference
								const leftOffset = Math.max(
									cardCommentsEl.offsetLeft + 20,
									300
								);
								imgElContainer.style.top = `${topPosition}px`;
								imgElContainer.style.left = `${leftOffset}px`;
								imgEl.src = imgUri;
							}
						});

						lineEl.addEventListener("mouseleave", () => {
							imgEl.src = "";
						});
					}
				}

				sectionList.appendChild(lineEl);
			} else if (line.lineType === "comment") {
				// Comments
				createSpan(lineEl, {
					cls: "comment",
					text: line.comments?.join(" ") || "",
				});

				sectionList.appendChild(lineEl);
			}
		});

		// Special handling for commander sections
		if (section === "Commander" && linesBySection[section].length > 0) {
			const commanderLine = linesBySection[section][0];
			if (commanderLine && commanderLine.cardName) {
				const cardId = nameToId(commanderLine.cardName);
				const cardInfo = cardDataByCardId[cardId];
				const commanderName =
					(cardInfo && cardInfo.name) ||
					commanderLine.cardName ||
					UNKNOWN_CARD;

				sectionHedingEl.textContent = commanderName;
				sectionHedingEl.classList.add("commander-heading");

				// Add image functionality for commanders
				if (cardInfo) {
					let imgUri: string | undefined;
					if (cardInfo.image_uris) {
						imgUri = cardInfo.image_uris?.large;
					} else if (
						cardInfo.card_faces &&
						cardInfo.card_faces.length > 1
					) {
						imgUri = cardInfo.card_faces[0].image_uris?.large;
					}

					if (imgUri) {
						sectionHedingEl.style.cursor = "pointer";

						if (settings.decklist.mobileMode) {
							// Mobile: use click to show centered overlay
							sectionHedingEl.addEventListener("click", (e) => {
								e.preventDefault();
								e.stopPropagation();
								showMobileCardImage(imgUri!);
							});
						} else {
							// Desktop: use hover as before
							sectionHedingEl.addEventListener(
								"mouseenter",
								() => {
									// Calculate positioning with bounds checking
									const offsetPaddingTop = 16;
									const imageHeight = 400;
									const containerRect =
										containerEl.getBoundingClientRect();
									const headingRect =
										sectionHedingEl.getBoundingClientRect();

									let topPosition =
										sectionHedingEl.offsetTop +
										offsetPaddingTop;

									if (
										topPosition + imageHeight >
										containerEl.scrollHeight
									) {
										topPosition =
											sectionHedingEl.offsetTop -
											imageHeight -
											offsetPaddingTop;
									}

									const leftPosition =
										containerEl.offsetWidth - 320;

									const imgEl = containerEl.querySelector(
										".card-image"
									) as HTMLImageElement;
									if (imgEl) {
										imgEl.src = imgUri!;
										imgEl.style.top = `${topPosition}px`;
										imgEl.style.left = `${Math.max(
											leftPosition,
											0
										)}px`;
									}
								}
							);

							sectionHedingEl.addEventListener(
								"mouseleave",
								() => {
									const imgEl = containerEl.querySelector(
										".card-image"
									) as HTMLImageElement;
									if (imgEl) {
										imgEl.src = "";
									}
								}
							);
						}
					}
				}
			} else {
				sectionHedingEl.textContent = `${section}`;
			}
		} else {
			sectionHedingEl.textContent = `${section}`;
		}

		sectionContainer.appendChild(sectionList);

		// Skip divider and totals for commander sections and mobile mode
		if (section !== "Commander" && !settings.decklist.mobileMode) {
			const horizontalDividorEl = document.createElement("hr");
			sectionContainer.appendChild(horizontalDividorEl);

			const totalsEl = createDiv(sectionContainer, {
				cls: "decklist__section-totals",
			});

			const sectionMissingCardIds = Object.keys(sectionMissingCardCounts);

			const totalCardsEl = createSpan(sectionContainer);
			const totalCostEl = createSpan(sectionContainer);

			// When there are missing cards, show fraction
			if (sectionMissingCardIds.length) {
				// Counts
				const totalMissingCountInSection = Object.values(
					sectionMissingCardCounts
				).reduce((acc, v) => acc + v, 0);

				const totalCardsOwned =
					sectionTotalCounts[section] - totalMissingCountInSection;

				// Errors
				createSpan(totalCardsEl, {
					cls: "error",
					text: `${totalCardsOwned}`,
				});

				// Counts
				createSpan(totalCardsEl, {
					cls: "insufficient-count",
					text: ` / ${sectionTotalCounts[section]}`,
				});

				totalCardsEl.classList.add("decklist__section-totals__count");

				const totalMissingCostInSection = Object.keys(
					sectionMissingCardCounts
				).reduce((acc, cardId) => {
					const countNeeded = sectionMissingCardCounts[cardId];
					const cardPrice: number = parseFloat(
						getCardPrice(
							cardId,
							cardDataByCardId,
							settings,
							isGenericList
						) || "0.00"
					);
					return acc + cardPrice * countNeeded;
				}, 0.0);

				// Value
				if (hasCardInfo && !settings.decklist.hidePrices) {
					const totalValueOwned =
						sectionTotalCost[section] - totalMissingCostInSection;
					const totalValueOwnedEl = createSpan(totalCostEl, {
						cls: "error",
						text: `${
							currencyMapping[settings.decklist.preferredCurrency]
						}${totalValueOwned.toFixed(2)}`,
					});

					// Total value needed
					createSpan(totalCostEl, {
						cls: "insufficient-count",
						text: ` / ${
							currencyMapping[settings.decklist.preferredCurrency]
						}${sectionTotalCost[section].toFixed(2)}`,
					});
				}

				// Otherwise show simple values
			} else {
				totalCardsEl.classList.add("decklist__section-totals__count");
				totalCardsEl.textContent = `${sectionTotalCounts[section]}`;
				if (!settings.decklist.hidePrices) {
					totalCostEl.textContent = `${
						currencyMapping[settings.decklist.preferredCurrency]
					}${sectionTotalCost[section].toFixed(2)}`;
				}
			}

			totalsEl.appendChild(totalCardsEl);

			const totalCardsUnitEl = createSpan(totalsEl, {
				cls: "card-name",
				text: "cards",
			});

			if (hasCardInfo && !settings.decklist.hidePrices) {
				totalsEl.appendChild(totalCostEl);
			}

			sectionContainer.appendChild(totalsEl);
		}

		sectionContainers.push(sectionContainer);
	});

	sectionContainers.forEach((sectionContainer) =>
		containerEl.appendChild(sectionContainer)
	);

	const buylistCardIds = Object.keys(missingCardCounts);
	const buylistCardCounts = Object.values(missingCardCounts).reduce(
		(acc, val) => acc + val,
		0
	);

	// Only show the buylist element when there are missing cards and this is a decklist (not generic list)
	if (
		buylistCardIds.length &&
		settings.decklist.showBuylist &&
		!isGenericList
	) {
		// Build Buylist
		const buylist = document.createElement("div");
		buylist.classList.add("buylist-container");

		const buylistHeader = document.createElement("h3");
		buylistHeader.classList.add("decklist__section-heading");
		buylistHeader.textContent = "Buylist: ";

		buylist.appendChild(buylistHeader);

		let totalCostOfBuylist = 0.0;

		let buylistLines = "";

		buylistCardIds.forEach((cardId) => {
			const cardInfo = cardDataByCardId[cardId];
			let buylistLine = "";

			const countNeeded = missingCardCounts[cardId];

			// const countEl = createSpan(buylistLineEl, {
			// 	cls: "decklist__section-totals__count",
			// 	text: `${countNeeded}`,
			// });

			// Add count
			buylistLine += `${countNeeded}` + " ";

			if (cardInfo) {
				const cardName = cardInfo.name || "";

				buylistLine += `${cardName}`;

				// Retrieve price
				const cardPrice: number = parseFloat(
					getCardPrice(
						cardName,
						cardDataByCardId,
						settings,
						isGenericList
					) || "0.00"
				);

				totalCostOfBuylist =
					totalCostOfBuylist + cardPrice * countNeeded;

				buylistLines += buylistLine + "\n";
			} else {
				// Card name might be unknown
				buylistLines += buylistLine + `${cardId || UNKNOWN_CARD}\n`;
			}
		});

		const buylistPre = document.createElement("pre");
		buylistPre.classList.add("buylist-container");
		buylistPre.textContent = buylistLines;

		buylist.appendChild(buylistPre);

		const horizontalDividorEl = document.createElement("hr");
		buylist.appendChild(horizontalDividorEl);

		const buylistLineEl = document.createElement("div");
		buylistLineEl.classList.add("buylist-line");

		// countEl
		createSpan(buylistLineEl, {
			cls: "decklist__section-totals__count",
			text: `${buylistCardCounts} `,
		});

		// cardNameEl
		createSpan(buylistLineEl, {
			cls: "card-name",
			text: "cards",
		});

		let totalPriceEl = null;
		if (hasCardInfo && !settings.decklist.hidePrices) {
			totalPriceEl = createSpan(buylistLineEl, {
				cls: "decklist__section-totals",
				text: `${
					currencyMapping[settings.decklist.preferredCurrency]
				}${totalCostOfBuylist.toFixed(2)}`,
			});
		}

		buylist.appendChild(buylistLineEl);

		footer.appendChild(buylist);
	}

	// Add overall summary section for desktop only (for both decklists and generic lists)
	if (!settings.decklist.mobileMode) {
		const overallTotalCards = Object.values(sectionTotalCounts).reduce(
			(acc, count) => acc + count,
			0
		);
		const overallTotalCost = Object.values(sectionTotalCost).reduce(
			(acc, cost) => acc + cost,
			0.0
		);

		if (overallTotalCards > 0) {
			const summaryContainer = createDiv(containerEl, {
				cls: "mtg-overall-summary",
			});

			const summaryHeader = document.createElement("h3");
			summaryHeader.textContent = isGenericList
				? "Total Summary"
				: "Overall Summary";
			summaryHeader.classList.add("mtg-summary-header");
			summaryContainer.appendChild(summaryHeader);

			const summaryContent = createDiv(summaryContainer, {
				cls: "mtg-summary-content",
			});

			createSpan(summaryContent, {
				cls: "mtg-summary-cards",
				text: `${overallTotalCards} Cards`,
			});

			if (hasCardInfo && !settings.decklist.hidePrices) {
				createSpan(summaryContent, {
					cls: "mtg-summary-cost",
					text: `${
						currencyMapping[settings.decklist.preferredCurrency]
					}${overallTotalCost.toFixed(2)} Total Value`,
				});
			}
		}
	}

	containerEl.appendChild(footer);

	// Add statistics section (only for decklists, not generic lists)
	if (!isGenericList) {
		createStatisticsSection(
			containerEl,
			parsedLines,
			cardDataByCardId,
			settings
		);
	}

	// Add export button for mtg-list at bottom right
	if (isGenericList) {
		createExportButton(
			containerEl,
			parsedLines,
			cardDataByCardId,
			settings
		);
	}

	return containerEl;
};
