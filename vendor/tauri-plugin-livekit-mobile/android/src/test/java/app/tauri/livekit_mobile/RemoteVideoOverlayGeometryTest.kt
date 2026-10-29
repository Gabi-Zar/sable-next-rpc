package app.tauri.livekit_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteVideoOverlayGeometryTest {
    @Test
    fun `css rect inside the viewport converts to physical pixels`() {
        assertEquals(
            OverlayRect(left = 20, top = 40, width = 640, height = 360),
            overlayRectFromCss(10.0, 20.0, 320.0, 180.0, 2.0, 1000, 1000),
        )
    }

    @Test
    fun `fractional density converts edges after clipping covering touched pixels`() {
        // left = 15.75 → 15, right = 258.75 → 259; top = 6.6 → 6,
        // bottom = 7.35 → 8: floor/ceil on the intersected edges.
        assertEquals(
            OverlayRect(left = 15, top = 6, width = 244, height = 2),
            overlayRectFromCss(10.5, 4.4, 162.0, 0.5, 1.5, 1000, 1000),
        )
    }

    @Test
    fun `negative offsets are accepted and clip to the viewport origin`() {
        assertEquals(
            OverlayRect(left = 0, top = 0, width = 80, height = 90),
            overlayRectFromCss(-10.0, -5.0, 50.0, 50.0, 2.0, 1000, 1000),
        )
        assertEquals(
            OverlayRect(left = 0, top = 0, width = 15, height = 20),
            overlayRectFromCss(-2.6, 0.0, 10.0, 10.0, 2.0, 100, 100),
        )
    }

    @Test
    fun `rects straddling the viewport edges are capped by clipping`() {
        assertEquals(
            OverlayRect(left = 5, top = 5, width = 15, height = 5),
            overlayRectFromCss(5.0, 5.0, 100.0, 100.0, 1.0, 20, 10),
        )
        // Absurd but finite sizes saturate, then clip down to the viewport.
        assertEquals(
            OverlayRect(left = 0, top = 0, width = 100, height = 20),
            overlayRectFromCss(0.0, 0.0, 1e300, 10.0, 2.0, 100, 1000),
        )
    }

    @Test
    fun `rects without any viewport intersection are rejected`() {
        // Fully to the right, fully above, and exactly edge-touching.
        assertNull(overlayRectFromCss(30.0, 0.0, 10.0, 10.0, 1.0, 20, 100))
        assertNull(overlayRectFromCss(0.0, -100.0, 10.0, 50.0, 1.0, 100, 100))
        assertNull(overlayRectFromCss(-10.0, 0.0, 10.0, 10.0, 1.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 10.0, 10.0, 10.0, 1.0, 100, 10))
    }

    @Test
    fun `sizes and density must be strictly positive`() {
        assertNull(overlayRectFromCss(0.0, 0.0, 0.0, 10.0, 1.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, 0.0, 1.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, -10.0, 10.0, 1.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, -10.0, 1.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, 10.0, 0.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, 10.0, -2.0, 100, 100))
    }

    @Test
    fun `non finite values are rejected`() {
        assertNull(overlayRectFromCss(Double.NaN, 0.0, 10.0, 10.0, 2.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, Double.NaN, 10.0, 10.0, 2.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, Double.NaN, 10.0, 2.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, Double.NaN, 2.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, 10.0, Double.NaN, 100, 100))
        assertNull(overlayRectFromCss(Double.POSITIVE_INFINITY, 0.0, 10.0, 10.0, 2.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, 10.0, Double.POSITIVE_INFINITY, 100, 100))
    }

    @Test
    fun `a degenerate viewport intersects nothing`() {
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, 10.0, 1.0, 0, 100))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, 10.0, 1.0, 100, 0))
        assertNull(overlayRectFromCss(0.0, 0.0, 10.0, 10.0, 1.0, -1, -1))
    }

    @Test
    fun `huge offsets cannot overflow the edge math`() {
        // left = 2e300 stays a finite Double; the small clipped right edge is
        // compared against it directly rather than wrapping a 32-bit sum.
        assertNull(overlayRectFromCss(1e300, 0.0, 10.0, 10.0, 2.0, 100, 100))
        assertNull(overlayRectFromCss(0.0, 1e300, 10.0, 10.0, 2.0, 100, 100))
        // A huge size reaching over the viewport still caps by clipping.
        assertEquals(
            OverlayRect(left = 4, top = 4, width = 96, height = 96),
            overlayRectFromCss(4.0, 4.0, 1e300, 1e300, 1.0, 100, 100),
        )
    }

    @Test
    fun `a sub pixel intersection still yields a tile covering it`() {
        // 0.38..1.52 px horizontally/vertically: non-empty, so the tile spans
        // the two physical pixels it touches instead of degenerating to zero.
        assertEquals(
            OverlayRect(left = 0, top = 0, width = 2, height = 2),
            overlayRectFromCss(0.2, 0.2, 0.6, 0.6, 1.9, 100, 100),
        )
    }

    @Test
    fun `translation lands on the host rect without parent padding`() {
        assertEquals(130f, overlayTranslation(0, 10f, 0, 120), 0f)
    }

    @Test
    fun `parent padding already offsets the child and is not applied twice`() {
        assertEquals(120f, overlayTranslation(96, 0f, 96, 120), 0f)
        assertEquals(25f, overlayTranslation(80, -15f, 40, 0), 0f)
    }
}
