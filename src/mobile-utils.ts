// Mobile detection and utility functions

/**
 * Detects if the current device is mobile based on various indicators
 */
export const isMobile = (): boolean => {
	// Check if we're in Obsidian mobile app (with type safety)
	if (
		typeof window !== "undefined" &&
		window.app &&
		"isMobile" in window.app
	) {
		return (window.app as any).isMobile;
	}

	// In test environment, always return false for consistency
	if (typeof window === "undefined" || typeof navigator === "undefined") {
		return false;
	}

	// Check for touch capability and small screen
	const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
	const isSmallScreen = window.innerWidth <= 768;

	// User agent based detection as fallback
	const mobileRegex =
		/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
	const isMobileUA = mobileRegex.test(navigator.userAgent);

	return hasTouch && (isSmallScreen || isMobileUA);
};

/**
 * Creates a centered overlay for displaying card images on mobile
 */
export const createMobileImageOverlay = (): HTMLElement => {
	const overlay = document.createElement("div");
	overlay.classList.add("mobile-card-overlay");

	const imageContainer = document.createElement("div");
	imageContainer.classList.add("mobile-card-image-container");

	const image = document.createElement("img");
	image.classList.add("mobile-card-image");

	const closeButton = document.createElement("button");
	closeButton.textContent = "×";
	closeButton.classList.add("mobile-card-close");

	imageContainer.appendChild(image);
	imageContainer.appendChild(closeButton);
	overlay.appendChild(imageContainer);

	// Close on overlay click
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) {
			hideMobileImageOverlay();
		}
	});

	// Close on button click
	closeButton.addEventListener("click", () => {
		hideMobileImageOverlay();
	});

	// Close on escape key
	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			hideMobileImageOverlay();
			document.removeEventListener("keydown", handleKeyDown);
		}
	};
	document.addEventListener("keydown", handleKeyDown);

	return overlay;
};

/**
 * Shows a card image in the mobile overlay
 */
export const showMobileCardImage = (imageUrl: string) => {
	// Remove any existing overlay
	hideMobileImageOverlay();

	const overlay = createMobileImageOverlay();
	const image = overlay.querySelector(
		".mobile-card-image"
	) as HTMLImageElement;

	if (image) {
		image.src = imageUrl;
		image.onload = () => {
			document.body.appendChild(overlay);
			// Add show class after DOM insertion for animation
			requestAnimationFrame(() => {
				overlay.classList.add("show");
			});
		};

		image.onerror = () => {
			console.warn("Failed to load card image:", imageUrl);
		};
	}
};

/**
 * Hides the mobile image overlay
 */
export const hideMobileImageOverlay = () => {
	const existingOverlay = document.querySelector(".mobile-card-overlay");
	if (existingOverlay) {
		existingOverlay.classList.remove("show");
		// Wait for animation to complete before removing
		setTimeout(() => {
			existingOverlay.remove();
		}, 200);
	}
};
