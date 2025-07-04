import os
import ee
from flask import Flask, render_template, request, jsonify
import math

# Initialize Earth Engine
# Ensure you have authenticated using `ee.Authenticate()` and then `ee.Initialize()`
# If you are deploying, consider using service account authentication for production.
try:
    # IMPORTANT: Replace 'ee-sachinbobbili' with your actual Earth Engine project ID.
    ee.Initialize(project='ee-sachinbobbili') 
    print("Earth Engine initialized successfully.")
except Exception as e:
    print(f"FATAL: Earth Engine Initialization Failed: {e}")
    ee = None # Set ee to None to indicate initialization failure

app = Flask(__name__)

# Helper function to convert GEE object to Python number with error handling
# This function is now more carefully used only when we expect an EE Number object.
def ee_number_to_float(ee_object):
    """Safely converts an Earth Engine Number object to a Python float.
       If the input is already a Python number, it returns it directly."""
    if isinstance(ee_object, (int, float)): # If it's already a Python number, return it.
        return ee_object
    if ee_object:
        try:
            return ee_object.getInfo()
        except ee.EEException:
            print(f"WARNING: Could not getInfo() for EE object: {ee_object}")
            return None
    return None

# Flask Routes
@app.route('/')
def index():
    """Renders the main HTML page of the application."""
    return render_template('index.html')

@app.route('/perform_analysis', methods=['POST'])
def perform_analysis_route():
    """
    Handles the POST request for performing geospatial analysis based on AOI.
    Receives AOI coordinates, performs GEE computations, and returns results.
    """
    if ee is None:
        return jsonify({'error': 'Earth Engine not initialized on the server.'}), 500

    data = request.get_json()
    # Expecting GeoJSON-like coordinates: [[[lon,lat],[lon,lat],...]] for a polygon
    aoi_coords = data.get('aoi_coordinates') 

    if not aoi_coords:
        return jsonify({'error': 'AOI coordinates are required.'}), 400

    try:
        # Convert AOI coordinates to ee.Geometry.Polygon
        # It expects a list of linear rings. For a single polygon, it's a list containing one ring.
        # Example for rectangle: [[[-122.4, 37.7], [-122.5, 37.7], [-122.5, 37.8], [-122.4, 37.8], [-122.4, 37.7]]]
        aoi = ee.Geometry.Polygon(aoi_coords)
        print(f"DEBUG: AOI geometry created from {len(aoi_coords[0]) if aoi_coords and aoi_coords[0] else 0} points.")

        # 1. Elevation Data and Classification
        dataset = ee.Image('USGS/SRTMGL1_003')
        elevation = dataset.select('elevation').clip(aoi)

        # Re-project empty image for consistent resolution (as in GEE script)
        # Using 30m nominal scale for consistency with WorldCover, and EPSG:4326 CRS
        empty_image = ee.Image(0).reproject('EPSG:4326', None, 30) 

        # Classify elevation: 1 for (30m < elevation < 2000m)
        dem_class = empty_image.where(
            (elevation.lt(2000).And(elevation.gt(30))), 1
        )

        # Calculate min/max elevation stats
        # .getInfo() here resolves the EE Dictionary to a Python Dictionary
        elevation_stats = elevation.reduceRegion(
            reducer=ee.Reducer.minMax(),
            geometry=aoi,
            scale=500, # Use 500m scale for stats as in original GEE script
            bestEffort=True
        ).getInfo()

        # 2. Slope Data and Classification
        slope = ee.Terrain.slope(elevation).clip(aoi)
        # Classify slope: 1 for <5 deg, 0.6 for 5-10 deg (and elevation < 10m), 0.4 for >10 deg
        slope_class = empty_image.where(
            (slope.lt(5)), 1
        ).where(
            (slope.gt(5).And(elevation.lt(10))), 0.6 # Original script had OR, re-checked and updated to AND for consistency with logic
        ).where(
            (slope.gt(10)), 0.4
        )

        # Calculate min/max/mean slope stats
        # .getInfo() here resolves the EE Dictionary to a Python Dictionary
        slope_stats = slope.reduceRegion(
            reducer=ee.Reducer.minMax().combine(ee.Reducer.mean(), sharedInputs=True),
            geometry=aoi,
            scale=500, # Use 500m scale for stats
            bestEffort=True
        ).getInfo()

        # 3. Land Use/Land Cover (LULC) Data and Classification
        # Using ESA WorldCover v200, which has a 'Map' band for LULC classes
        lulc_collection = ee.ImageCollection('ESA/WorldCover/v200')
        lulc = lulc_collection.first().clip(aoi) # Get the first image (often the latest)

        # WorldCover classes: 20=Shrubland, 60=Barren/Sparse Vegetation
        # Classify LULC: 1 for Shrubland or Barren/Sparse Vegetation
        class_lulc = empty_image.where(
            (lulc.eq(20).Or(lulc.eq(60))), 1
        )

        # Suitability Overlay: Combine classifications
        # Sum the classified layers. A value of 3 means all three criteria (DEM, Slope, LULC) are met.
        suitability_raw = dem_class.add(slope_class).add(class_lulc)
        
        # Reclassify raw suitability scores into discrete suitability levels (1-4)
        suitability = empty_image.where(suitability_raw.eq(3), 1) \
                             .where(suitability_raw.eq(2.6), 2) \
                             .where(suitability_raw.eq(2.4), 3) \
                             .where(suitability_raw.lt(2.4), 4)

        # Mask out areas that are not suitable (value < 1)
        suitability = suitability.updateMask(suitability.gte(1)).clip(aoi)

        # Suitability Visualization Palette (matching GEE script)
        suitability_vis = {
            'min': 0, 'max': 4,
            'palette': ['#FFFFFF', '#52E929', '#F5A742', '#AB2103', '#FF0000']
        }
        # Get map tile URL for the final suitability layer to display on frontend
        suitability_map_id = suitability.getMapId(suitability_vis)
        suitability_tile_url = suitability_map_id['tile_fetcher'].url_format
        print(f"DEBUG: Suitability tile URL generated: {suitability_tile_url[:70]}...")

        # 4. Calculate Area for Chart
        # Define names for suitability classes (matching frontend chart labels)
        names = ['Most Suitable', 'Medium Suitable', 'Less Suitable', 'Not Suitable']
        # Reclassify suitability into separate bands for each class for accurate area calculation
        # E.g., a band 'Most Suitable' will have 1 where suitability is 1, and 0 elsewhere.
        count = suitability.eq([1, 2, 3, 4]).rename(names)

        # Calculate pixel area in square kilometers (pixelArea() returns m^2, divide by 10^6)
        pixel_area_image = ee.Image.pixelArea().divide(1000 * 1000) # km^2

        # Reduce region to get sum of areas for each suitability class
        # .getInfo() here resolves the EE Dictionary to a Python Dictionary
        total_area_by_class = count.multiply(pixel_area_image).reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=aoi,
            scale=100, # Use 100m scale for area calculation as in GEE script
            maxPixels=1e11, # Allow processing a large number of pixels
            bestEffort=True
        ).getInfo()

        # Prepare data for the bar chart (list of dictionaries)
        chart_data_features = []
        for name in names:
            # area_val is already a Python number from total_area_by_class.get()
            area_val = total_area_by_class.get(name, 0) 
            chart_data_features.append({
                'Suitability': name,
                # No need to call ee_number_to_float here, as area_val is already a float/int
                'Area': round(area_val, 2) if area_val is not None else 0,
                'Type': name 
            })
        print("DEBUG: Chart data generated.")
        
        # 5. Power Generation Calculation
        most_suitable_area_sqkm = total_area_by_class.get('Most Suitable', 0) # Already a Python number
        # Formula from original GEE script: Area (km^2) * 1.7 (kW/m^2) * 0.85 (efficiency) * 300 (days)
        power_generation_mwh = (most_suitable_area_sqkm * 1.7 * 0.85 * 300) if most_suitable_area_sqkm is not None else 0
        power_generation_mwh = round(power_generation_mwh, 3)
        print(f"DEBUG: Power generation (MWh): {power_generation_mwh}")

        # 6. Number of Solar Panels Required
        # most_suitable_area_sqkm is already a Python number
        num_panels = (most_suitable_area_sqkm * 1.7 * 0.85 * 1000000) if most_suitable_area_sqkm is not None else 0
        num_panels = round(num_panels)
        print(f"DEBUG: Number of panels: {num_panels}")

        # 7. Solar Radiation Data (for display as a map layer)
        solar_radiation = ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR") \
                            .filterDate('2024-01-01', '2024-12-31') \
                            .mean() \
                            .select("surface_solar_radiation_downwards_sum") \
                            .clip(aoi)

        solar_radiation_vis = {'min': 10000000, 'max': 20000000, 'palette': ['blue', 'green', 'yellow', 'red']} # Example palette
        solar_radiation_map_id = solar_radiation.getMapId(solar_radiation_vis)
        solar_radiation_tile_url = solar_radiation_map_id['tile_fetcher'].url_format
        print(f"DEBUG: Solar radiation tile URL generated: {solar_radiation_tile_url[:70]}...")

        # 8. Download link for the suitable areas as KML (Removed as per user request)
        # The following code block was removed:
        # vectors = suitability.reduceToVectors(
        #     geometry=aoi, 
        #     scale=100,    
        #     maxPixels=1e11, 
        #     geometryType='polygon' 
        # ).map(lambda feature: feature.set({
        #     'SuitabilityType': ee.Algorithms.If(ee.Number(feature.get('label')).eq(1), 'Most Suitable',
        #                           ee.Algorithms.If(ee.Number(feature.get('label')).eq(2), 'Medium Suitable',
        #                             ee.Algorithms.If(ee.Number(feature.get('label')).eq(3), 'Less Suitable',
        #                               ee.Algorithms.If(ee.Number(feature.get('label')).eq(4), 'Not Suitable', 'Unknown'))))
        # }))
        # kml_url = ee.data.make_download_url(
        #     vectors, 
        #     params={'format': 'KML', 'filename': 'SuitableAreas'}
        # )
        # print(f"DEBUG: KML download URL generated: {kml_url[:70]}...")
        
        # 9. Determine map center and zoom level for the AOI
        # .getInfo() here resolves the EE List to a Python List
        center = aoi.centroid().coordinates().getInfo() # Returns [lon, lat]
        map_center = [center[1], center[0]] # Convert to [lat, lon] for Leaflet

        # Calculate a rough zoom level based on the AOI's bounding box extent
        # .getInfo() here resolves the EE Dictionary to a Python Dictionary
        bounds_geojson = aoi.bounds().getInfo()
        map_zoom = 10 # Default zoom if bounds are problematic

        if 'coordinates' in bounds_geojson and len(bounds_geojson['coordinates']) > 0:
            # For a simple polygon/rectangle, coordinates will be a list of rings.
            # We need to flatten and find min/max lon/lat
            lons = [p[0] for ring in bounds_geojson['coordinates'] for p in ring]
            lats = [p[1] for ring in bounds_geojson['coordinates'] for p in ring]
            
            if lons and lats: # Ensure lists are not empty
                min_lon = min(lons)
                max_lon = max(lons)
                min_lat = min(lats)
                max_lat = max(lats)

                delta_lon = max_lon - min_lon
                delta_lat = max_lat - min_lat

                # Heuristic for zoom level based on geographic extent
                # This is an approximation; Leaflet's fitBounds on the client is more precise.
                if delta_lon > 0 and delta_lat > 0:
                    zoom_lon = math.log2(360 / delta_lon) if delta_lon > 0 else 0
                    zoom_lat = math.log2(180 / delta_lat) if delta_lat > 0 else 0
                    # Take the smaller zoom to ensure the entire AOI fits
                    map_zoom = max(1, min(math.floor(min(zoom_lon, zoom_lat)) + 1, 16)) # Clamp zoom to 1-16
                else:
                    map_zoom = 10 # Default for very small or point-like areas
        print(f"DEBUG: Calculated map center: {map_center}, zoom: {map_zoom}")

        # Return all computed results to the frontend
        return jsonify({
            'status': 'success',
            'suitability_tile_url': suitability_tile_url,
            'solar_radiation_tile_url': solar_radiation_tile_url,
            'chart_data': chart_data_features,
            # These values are already Python floats from elevation_stats and slope_stats dictionaries
            'elevation_min': elevation_stats.get('elevation_min'),
            'elevation_max': elevation_stats.get('elevation_max'),
            'slope_min': slope_stats.get('slope_min'),
            'slope_max': slope_stats.get('slope_max'),
            'power_generation_mwh': power_generation_mwh,
            'num_panels': num_panels,
            # Removed 'kml_download_url' from the response as it's no longer generated
            'map_center': map_center,
            'map_zoom': map_zoom
        })

    except Exception as e:
        import traceback
        print(f"ERROR during analysis in /perform_analysis: {e}")
        traceback.print_exc() # Print full traceback for server-side debugging
        return jsonify({'error': f'Failed to perform analysis: {e}'}), 500

# Entry point for the Flask application
if __name__ == '__main__':
    # Run in debug mode during development for auto-reloading and detailed errors.
    # For production, use a production-ready WSGI server like Gunicorn or uWSGI.
    app.run(debug=True, port=5000)
