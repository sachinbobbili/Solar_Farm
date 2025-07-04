// --- Global Variables & UI Element References ---
// Get references to all necessary HTML elements by their IDs
const controlsPanel = document.getElementById('controls-panel');
const aoiMethodSelect = document.getElementById('aoiMethodSelect');
const instructions = document.getElementById('instructions');
const analyzeButton = document.getElementById('analyzeButton');
const kmlLink = document.getElementById('kmlLink');
const lulcChartCanvas = document.getElementById('lulcChart');
const chartStatus = document.getElementById('chartStatus');

const elevationRangeOutput = document.getElementById('elevationRange');
const slopeRangeOutput = document.getElementById('slopeRange');
const powerGenerationOutput = document.getElementById('powerGeneration');
const numPanelsOutput = document.getElementById('numPanels');

// References to the containers for layer checkboxes (for showing/hiding)
const suitabilityLayerContainer = document.getElementById('suitabilityLayerContainer');
const solarLayerContainer = document.getElementById('solarLayerContainer');

// References to the actual checkbox input elements (for checking/unchecking)
const toggleSuitabilityLayer = document.getElementById('toggleSuitabilityLayer');
const toggleSolarLayer = document.getElementById('toggleSolarLayer');

const dynamicInputContainer = document.getElementById('dynamicInputContainer');
const resultsPanelContent = document.getElementById('results-panel-content'); // Container for all analysis results

// Global variables for Leaflet map, drawing tools, and Chart.js instance
let map;
let drawnItems;
let drawingTools;
let currentChart;
let suitabilityTileLayer = null; // Stores the Leaflet tile layer for suitability map
let solarRadiationTileLayer = null; // Stores the Leaflet tile layer for solar radiation map

// --- Function to Initialize Map and Drawing Tools ---
function initializeMap() {
    console.log("initializeMap() called.");

    // Check if map is already initialized. If so, only reset layers/view, don't re-create.
    // This function should ideally only be called once on DOMContentLoaded.
    if (map) {
        console.warn("Map instance already exists. Skipping re-initialization.");
        return;
    }

    const mapContainer = document.getElementById('map-container');
    if (!mapContainer) {
        console.error("Error: '#map-container' element not found. Map cannot be initialized.");
        return;
    }
    console.log("Map container found:", mapContainer);

    // Initialize Leaflet map on the 'map-container' div
    map = L.map('map-container', {
        zoom: 10, // Initial zoom level
        minZoom: 2, // Minimum zoom level allowed
        maxZoom: 18, // Maximum zoom level allowed
        zoomControl: true // Display zoom controls (+/- buttons)
    }).setView([17.4065, 78.4772], 10); // Set initial view (center: India, zoom: 10)

    console.log("Leaflet map object created:", map);

    // Add Esri World Imagery as the base map layer (provides satellite/hybrid look)
    L.tileLayer('http://mt0.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        maxZoom: 18,
        minZoom: 1
    }).addTo(map);
    console.log("Google Hybrid Imagery tile layer added to map.");

    // Initialize Leaflet.Draw for drawing AOIs
    drawnItems = new L.FeatureGroup(); // A layer group to hold drawn shapes
    map.addLayer(drawnItems); // Add the layer group to the map
    console.log("Drawn items FeatureGroup added to map.");

    drawingTools = new L.Control.Draw({
        edit: {
            featureGroup: drawnItems, // Allow editing of shapes in this group
            poly: { allowIntersection: false } // Prevent polygons from self-intersecting
        },
        draw: {
            polyline: false, // Disable polyline drawing
            circle: false,   // Disable circle drawing
            marker: false,   // Disable marker drawing
            circlemarker: false, // Disable circle marker drawing
            polygon: { allowIntersection: false, showArea: true }, // Enable polygon drawing, show area
            rectangle: { showArea: true } // Enable rectangle drawing, show area
        }
    });
    // Do NOT add drawingTools to map here initially. It will be added when 'drawAoi' is selected.
    console.log("Leaflet.Draw control initialized. It will be added to map when 'Draw AOI' is selected.");


    // --- Event Listeners for Leaflet.Draw Events ---
    // Fired when a new shape (rectangle/polygon) is finished drawing
    map.on(L.Draw.Event.CREATED, function (event) {
        console.log("L.Draw.Event.CREATED fired! Layer created.");
        const layer = event.layer;
        drawnItems.clearLayers(); // Clear any previous AOI
        drawnItems.addLayer(layer); // Add the newly drawn AOI
        instructions.textContent = 'AOI drawn. Click "Analyze AOI" to proceed.';
        analyzeButton.style.display = 'block'; // Show the Analyze button
        
        // After drawing, remove the drawing tools from the map to hide the toolbar
        map.removeControl(drawingTools); 
        console.log("AOI drawn, analyze button shown, drawing tools removed from map (hidden).");
    });

    // Fired when a drawn layer is deleted (e.g., by user interaction with Leaflet.Draw edit tools)
    map.on(L.Draw.Event.DELETED, function () {
        console.log("L.Draw.Event.DELETED fired! Layer deleted.");
        if (drawnItems.getLayers().length === 0) { // Check if no layers remain after deletion
            instructions.textContent = 'Draw a rectangle/polygon on the map to define your area of interest (AOI).';
            analyzeButton.style.display = 'none'; // Hide analyze button
            resetAnalysisResults(); // Clear analysis results
            
            // If the user was in 'drawAoi' mode and deleted the AOI, re-add drawing tools to map
            if (aoiMethodSelect.value === 'drawAoi') {
                map.addControl(drawingTools); // Show the toolbar again for drawing
                console.log("AOI deleted, re-adding drawing tools to map for 'drawAoi' mode.");
            }
        }
    });

    // --- Event Listeners for Map Layer Toggles ---
    // Listener for the Suitability Map checkbox
    toggleSuitabilityLayer.addEventListener('change', function() {
        console.log("Suitability layer toggle clicked. Checked:", this.checked);
        if (suitabilityTileLayer) { // Check if the tile layer object exists
            if (this.checked) {
                suitabilityTileLayer.addTo(map); // Add layer to map if checked
            } else {
                map.removeLayer(suitabilityTileLayer); // Remove layer from map if unchecked
            }
        } else {
            console.warn("Suitability tile layer is null. Cannot toggle.");
        }
    });

    // Listener for the Solar Radiation Map checkbox
    toggleSolarLayer.addEventListener('change', function() {
        console.log("Solar layer toggle clicked. Checked:", this.checked);
        if (solarRadiationTileLayer) { // Check if the tile layer object exists
            if (this.checked) {
                solarRadiationTileLayer.addTo(map); // Add layer to map if checked
            } else {
                map.removeLayer(solarRadiationTileLayer); // Remove layer from map if unchecked
            }
        } else {
            console.warn("Solar radiation tile layer is null. Cannot toggle.");
        }
    });
    console.log("Layer toggle listeners attached.");

    // Invalidate map size after initialization to ensure it renders correctly
    map.invalidateSize();
    console.log("Map invalidateSize() called after initialization.");
}

// --- Chart.js Initialization ---
function initializeChart(chartData) {
    console.log("initializeChart() called with data:", chartData);
    if (currentChart) {
        currentChart.destroy(); // Destroy previous chart instance if it exists
    }
    const ctx = lulcChartCanvas.getContext('2d'); // Get 2D rendering context of the canvas
    // Set explicit width and height for the canvas element
    lulcChartCanvas.width = 400;
    lulcChartCanvas.height = 250;

    currentChart = new Chart(ctx, {
        type: 'bar', // Type of chart (bar chart)
        data: {
            labels: chartData.map(item => item.Suitability), // X-axis labels from suitability names
            datasets: [{
                label: 'Area (km²)', // Label for the dataset
                data: chartData.map(item => item.Area), // Y-axis values from suitability areas
                backgroundColor: ['#52E929', '#F5A742', '#AB2103', '#FF0000'], // Colors for bars
                borderColor: ['#52E929', '#F5A742', '#AB2103', '#FF0000'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: false, // Set to false to respect canvas's fixed width/height
            maintainAspectRatio: false, // Crucial for allowing fixed height container to control canvas height
            scales: {
                y: {
                    beginAtZero: true, // Y-axis starts from zero
                    title: {
                        display: true,
                        text: 'Area (km²)',
                        font: { size: 10 } // Smaller font for axis title
                    },
                    ticks: { font: { size: 9 } } // Smaller font for ticks
                },
                x: {
                    title: {
                        display: true,
                        text: 'Suitability',
                        font: { size: 10 } // Smaller font for axis title
                    },
                    ticks: { font: { size: 9 } } // Smaller font for ticks
                }
            },
            plugins: {
                legend: {
                    display: false // Hide legend as colors are directly on bars
                }
            }
        }
    });
    console.log("Chart initialized/updated with fixed dimensions.");
}


// --- Functions to update UI elements with analysis results ---
function updateAnalysisResults(data) {
    console.log("updateAnalysisResults() called with data:", data);
    // Show the results panel content
    resultsPanelContent.style.display = 'block';

    // Update observation text fields
    elevationRangeOutput.textContent = `Elevation Range in Meters: ${data.elevation_min.toFixed(0)} - ${data.elevation_max.toFixed(0)}`;
    slopeRangeOutput.textContent = `Slope Range in Degrees: ${data.slope_min.toFixed(2)} - ${data.slope_max.toFixed(2)}`;
    powerGenerationOutput.textContent = `Most Suitable area Power Generation (MWh): ${data.power_generation_mwh.toFixed(3)}`;
    numPanelsOutput.textContent = `Number of Solar Panels Required: ${data.num_panels.toFixed(0)}`;

    // Update and display the chart
    initializeChart(data.chart_data);
    chartStatus.textContent = 'Chart updated with analysis results.';
    chartStatus.style.color = 'green';



    // Add Suitability Map layer to Leaflet
    if (suitabilityTileLayer) {
        map.removeLayer(suitabilityTileLayer); // Remove old layer if exists
    }
    suitabilityTileLayer = L.tileLayer(data.suitability_tile_url).addTo(map); // Add new layer
    suitabilityLayerContainer.style.display = 'flex'; // Show its container
    toggleSuitabilityLayer.checked = true; // Ensure its checkbox is checked
    console.log("Suitability layer added to map.");

    // Prepare Solar Radiation Map layer (don't add to map immediately, let user toggle)
    if (solarRadiationTileLayer) {
        map.removeLayer(solarRadiationTileLayer); // Remove old layer if exists
    }
    solarRadiationTileLayer = L.tileLayer(data.solar_radiation_tile_url); 
    solarLayerContainer.style.display = 'flex'; // Show its container
    toggleSolarLayer.checked = false; // Ensure its checkbox is unchecked initially
    console.log("Solar radiation layer prepared.");

    // Set map view to the analyzed AOI's center and zoom
    if (data.map_center && data.map_zoom) {
        map.setView(data.map_center, data.map_zoom);
        console.log(`Map view set to center: ${data.map_center}, zoom: ${data.map_zoom}`);
    }
    // Invalidate map size to ensure it renders correctly after panel visibility changes
    map.invalidateSize(); 
    console.log("Map invalidateSize called.");
}

// --- Function to reset all analysis results and map state ---
function resetAnalysisResults() {
    console.log("resetAnalysisResults() called.");
    // Hide the results panel content
    resultsPanelContent.style.display = 'none';

    // Reset observation text fields
    elevationRangeOutput.textContent = ' Elevation Range in Meters: -';
    slopeRangeOutput.textContent = 'Slope Range in Degrees: -';
    powerGenerationOutput.textContent = ' Power Generation for Most Suitable area (MWh): -';
    numPanelsOutput.textContent = ' Number of Solar Panels Required: -';
    
    // Reset chart to empty state
    initializeChart([]); 
    chartStatus.textContent = 'Run analysis to see chart data.';
    chartStatus.style.color = '#666';

    // Remove GEE layers from map if they exist
    if (suitabilityTileLayer) {
        map.removeLayer(suitabilityTileLayer);
        suitabilityTileLayer = null;
    }
    if (solarRadiationTileLayer) {
        map.removeLayer(solarRadiationTileLayer);
        solarRadiationTileLayer = null;
    }
    // Hide layer control containers
    suitabilityLayerContainer.style.display = 'none';
    solarLayerContainer.style.display = 'none';

    // Re-center map to default India view
    map.setView([17.4065, 78.4772], 10);
    // Invalidate map size after resetting
    map.invalidateSize(); 
    console.log("Analysis results reset, map re-centered.");
}

// --- Main Event Listener for AOI Method Selection ---
aoiMethodSelect.addEventListener('change', function() {
    const method = this.value; // Get the selected value from the dropdown
    console.log("AOI method selected via dropdown change:", method);
    
    // Clear any existing drawn AOIs from the map
    drawnItems.clearLayers();
    // Reset all analysis results display
    resetAnalysisResults();
    
    // Hide the main Analyze button and clear dynamic input fields by default
    analyzeButton.style.display = 'none';
    dynamicInputContainer.innerHTML = ''; 
    
    // Always attempt to remove drawingTools from map when a new method is selected
    // This ensures the toolbar is hidden unless 'drawAoi' is specifically chosen.
    // We don't need map.hasControl() check, as removeControl is safe to call even if not present.
    map.removeControl(drawingTools); 
    console.log("Cleared drawings, reset results, hid analyze button, ensured drawing tools are removed from map.");

    instructions.style.display = 'block'; // Ensure instructions are visible

    switch (method) {
        case 'drawAoi':
            instructions.textContent = 'Click on the draw tool icon on the map (rectangle or polygon) to define your AOI. Then click "Analyze AOI".';
            // Enable specific drawing options and add the toolbar back to the map
            drawingTools.setDrawingOptions({ polygon: true, rectangle: true }); 
            map.addControl(drawingTools); // Show the toolbar
            console.log("Switched to 'Draw AOI' mode. Drawing tools enabled and toolbar shown.");
            // The analyzeButton will be shown by the L.Draw.Event.CREATED listener
            break;
        case 'defineBbox':
            instructions.textContent = 'Enter the coordinates for the bounding box below, then click "Analyze AOI".';
            
            // HTML for bounding box input fields and a submit button
            const bboxPanelHTML = `
                <div class="panel-section">
                    <label>North Latitude (max):</label><input type="number" step="any" id="northLatInput" placeholder="e.g., 25.0" class="app-textbox" required><br>
                    <label>South Latitude (min):</label><input type="number" step="any" id="southLatInput" placeholder="e.g., 20.0" class="app-textbox" required><br>
                    <label>East Longitude (max):</label><input type="number" step="any" id="eastLonInput" placeholder="e.g., 80.0" class="app-textbox" required><br>
                    <label>West Longitude (min):</label><input type="number" step="any" id="westLonInput" placeholder="e.g., 75.0" class="app-textbox" required><br>
                    <button id="submitBboxBtn" class="app-button">📝 Analyze AOI</button>
                </div>
            `;
            dynamicInputContainer.innerHTML = bboxPanelHTML; // Inject HTML into the container
            console.log("Switched to 'Define Bounding Box' mode. Input fields generated.");

            // Attach event listener to the dynamically created submit button
            document.getElementById('submitBboxBtn').addEventListener('click', function() {
                console.log("Submit Bbox button clicked.");
                // Parse input values as floats
                const northLat = parseFloat(document.getElementById('northLatInput').value);
                const southLat = parseFloat(document.getElementById('southLatInput').value);
                const eastLon = parseFloat(document.getElementById('eastLonInput').value);
                const westLon = parseFloat(document.getElementById('westLonInput').value);

                // Basic validation for numeric input
                if (isNaN(northLat) || isNaN(southLat) || isNaN(eastLon) || isNaN(westLon)) {
                    alert('Please enter valid numeric coordinates for the bounding box.');
                    console.error("Invalid bounding box coordinates.");
                    return;
                }
                
                // More robust validation for coordinate ranges and logical order
                if (northLat <= southLat) { alert('North Latitude must be greater than South Latitude.'); return; }
                if (eastLon <= westLon) { alert('East Longitude must be greater than West Longitude.'); return; }
                if (northLat > 90 || northLat < -90 || southLat > 90 || southLat < -90) { alert('Latitude must be between -90 and 90.'); return; }
                if (eastLon > 180 || eastLon < -180 || westLon > 180 || westLon < -180) { alert('Longitude must be between -180 and 180.'); return; }


                // Construct GeoJSON Polygon coordinates: [[[lon, lat], [lon, lat], ...]]
                // This format is expected by ee.Geometry.Polygon on the backend.
                const aoiCoords = [[
                    [westLon, northLat], // Top-left corner (lon, lat)
                    [eastLon, northLat], // Top-right corner
                    [eastLon, southLat], // Bottom-right corner
                    [westLon, southLat], // Bottom-left corner
                    [westLon, northLat]  // Close the polygon by repeating the first point
                ]];
                console.log("Bounding Box AOI coordinates:", aoiCoords);
                sendAnalysisRequest(aoiCoords); // Send to backend for analysis
            });
            break;
        case 'resetAoi':
            instructions.textContent = 'Map and analysis results have been reset. Select an AOI method to begin.';
            resetAnalysisResults(); // Perform full reset
            aoiMethodSelect.value = ''; // Reset dropdown to the "Please select" option
            console.log("Switched to 'Reset AOI' mode. All reset.");
            break;
        default:
            // This case handles the initial state or if an invalid option is selected
            instructions.textContent = 'Please select your choice from the dropdown.';
            analyzeButton.style.display = 'none';
            // Ensure drawing tools are removed if an invalid/default option is chosen
            map.removeControl(drawingTools); // Remove control for default/invalid selection
            dynamicInputContainer.innerHTML = '';
            console.log("Default AOI method state.");
            break;
    }
});

// --- Event Listener for the main Analyze AOI Button (for drawn AOI) ---
analyzeButton.addEventListener('click', function() {
    console.log("Analyze AOI button clicked (from drawn AOI).");
    const layers = drawnItems.getLayers();
    if (layers.length === 0) {
        alert('Please draw an Area of Interest (AOI) on the map first using the draw tools.');
        console.error("No drawn layers found.");
        return;
    }
    const aoiLayer = layers[0]; // Get the first (and only) drawn layer
    let aoiCoords;

    // Get GeoJSON coordinates from the drawn layer
    // Leaflet's toGeoJSON() method provides the geometry object, then extract coordinates.
    aoiCoords = aoiLayer.toGeoJSON().geometry.coordinates;
    console.log("Drawn AOI coordinates:", aoiCoords);
    sendAnalysisRequest(aoiCoords); // Send to backend for analysis
});

// --- Function to send data to Flask backend for analysis ---
function sendAnalysisRequest(aoiCoordinates) {
    instructions.textContent = 'Analyzing... Please wait. This may take a moment.';
    console.log("Sending analysis request with coordinates:", aoiCoordinates);
    
    fetch('/perform_analysis', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ aoi_coordinates: aoiCoordinates }),
    })
    .then(response => {
        console.log("Received response from backend. Status:", response.status);
        if (!response.ok) { // Check if the HTTP response status is not OK (e.g., 4xx or 5xx)
            return response.json().then(err => {
                const errorMessage = err.error || 'Server error';
                console.error('Backend error response:', errorMessage, err);
                throw new Error(errorMessage); // Throw an error to be caught by the .catch block
            });
        }
        return response.json(); // Parse JSON response if OK
    })
    .then(data => {
        if (data.status === 'success') {
            console.log("Analysis successful. Data:", data);
            updateAnalysisResults(data); // Update frontend UI with results
            instructions.textContent = 'Analysis complete!';
        } else {
            // This block handles custom error messages from your Flask app if status is not 'success'
            alert('Analysis failed: ' + data.error);
            instructions.textContent = 'Analysis failed. Check console for details.';
            console.error('Analysis error from server (status not success):', data.error);
        }
    })
    .catch((error) => {
        // Catch any errors during fetch or in the .then blocks
        console.error('Fetch error:', error);
        alert('An error occurred during the analysis request: ' + error.message);
        instructions.textContent = 'Error during analysis. Check console.';
    });
}

// --- Initial setup when the DOM is fully loaded ---
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOMContentLoaded fired. Initializing application...");
    initializeMap(); // Initialize Leaflet map and drawing tools
    initializeChart([]); // Initialize an empty chart on the canvas
    resetAnalysisResults(); // Hide results panel and clear content initially
    
    // Manually trigger the 'change' event on the dropdown to set the initial UI state
    // This will activate the "Please select AOI Method" state and hide unnecessary elements.
    aoiMethodSelect.dispatchEvent(new Event('change'));
    console.log("Initial setup complete.");
});
