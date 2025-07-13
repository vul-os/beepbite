/**
 * Mapbox API utility functions for geocoding and route visualization
 */

declare const Deno: any;

export interface Coordinates {
  longitude: number;
  latitude: number;
}

export interface GeocodeResult {
  success: boolean;
  error?: string;
  address?: string;
  coordinates?: Coordinates;
  place_name?: string;
}

export interface RouteImageResult {
  success: boolean;
  error?: string;
  imageUrl?: string;
  imageBuffer?: ArrayBuffer;
}

/**
 * Convert an address string to GPS coordinates using Mapbox Geocoding API
 * @param address - The address string to geocode
 * @returns Promise<GeocodeResult> - Result containing coordinates and formatted address
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const apiKey = Deno.env.get('MAPBOX_API_KEY') ?? '';
  
  if (!apiKey) {
    return {
      success: false,
      error: 'Mapbox API key not found in environment variables'
    };
  }

  if (!address || address.trim() === '') {
    return {
      success: false,
      error: 'Address string is required'
    };
  }

  try {
    // Encode the address for URL
    const encodedAddress = encodeURIComponent(address.trim());
    
    // Mapbox Geocoding API endpoint
    const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?access_token=${apiKey}&limit=1`;
    
    const response = await fetch(geocodeUrl);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.message || `Mapbox Geocoding API error: ${response.status}`;
      return {
        success: false,
        error: errorMessage
      };
    }

    const result = await response.json();
    
    // Check if we got any results
    if (!result.features || result.features.length === 0) {
      return {
        success: false,
        error: 'No geocoding results found for the provided address'
      };
    }

    const feature = result.features[0];
    const [longitude, latitude] = feature.center;
    
    console.log('Geocoding successful:', {
      address: feature.place_name,
      coordinates: { longitude, latitude }
    });
    
    return {
      success: true,
      address: feature.place_name,
      place_name: feature.place_name,
      coordinates: {
        longitude,
        latitude
      }
    };

  } catch (error) {
    const errorMessage = `Mapbox Geocoding network error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Convert GPS coordinates to address using Mapbox Reverse Geocoding API
 * @param latitude - The latitude coordinate
 * @param longitude - The longitude coordinate
 * @returns Promise<GeocodeResult> - Result containing address and coordinates
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult> {
  const apiKey = Deno.env.get('MAPBOX_API_KEY') ?? '';
  
  if (!apiKey) {
    return {
      success: false,
      error: 'Mapbox API key not found in environment variables'
    };
  }

  if (isNaN(latitude) || isNaN(longitude)) {
    return {
      success: false,
      error: 'Valid latitude and longitude coordinates are required'
    };
  }

  try {
    // Mapbox Reverse Geocoding API endpoint
    const reverseGeocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${apiKey}&limit=1`;
    
    const response = await fetch(reverseGeocodeUrl);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.message || `Mapbox Reverse Geocoding API error: ${response.status}`;
      return {
        success: false,
        error: errorMessage
      };
    }

    const result = await response.json();
    
    // Check if we got any results
    if (!result.features || result.features.length === 0) {
      return {
        success: false,
        error: 'No reverse geocoding results found for the provided coordinates'
      };
    }

    const feature = result.features[0];
    
    console.log('Reverse geocoding successful:', {
      address: feature.place_name,
      coordinates: { longitude, latitude }
    });
    
    return {
      success: true,
      address: feature.place_name,
      place_name: feature.place_name,
      coordinates: {
        longitude,
        latitude
      }
    };

  } catch (error) {
    const errorMessage = `Mapbox Reverse Geocoding network error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Generate a route image between two GPS coordinates using Mapbox Static Images API
 * @param source - Source coordinates {longitude, latitude}
 * @param destination - Destination coordinates {longitude, latitude}
 * @param options - Optional parameters for image generation
 * @returns Promise<RouteImageResult> - Result containing image URL or buffer
 */
export async function generateRouteImage(
  source: Coordinates,
  destination: Coordinates,
  options: {
    width?: number;
    height?: number;
    returnBuffer?: boolean;
    zoom?: number;
    style?: string;
  } = {}
): Promise<RouteImageResult> {
  const apiKey = Deno.env.get('MAPBOX_API_KEY') ?? '';
  
  if (!apiKey) {
    return {
      success: false,
      error: 'Mapbox API key not found in environment variables'
    };
  }

  if (!source || !destination) {
    return {
      success: false,
      error: 'Source and destination coordinates are required'
    };
  }

  try {
    const {
      width = 600,
      height = 400,
      returnBuffer = false,
      zoom = 12,
      style = 'streets-v11'
    } = options;

    // Create markers for source (green) and destination (red)
    const sourceMarker = `pin-s-a+00ff00(${source.longitude},${source.latitude})`;
    const destMarker = `pin-s-b+ff0000(${destination.longitude},${destination.latitude})`;
    
    // First, get the route from Mapbox Directions API
    const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${source.longitude},${source.latitude};${destination.longitude},${destination.latitude}?access_token=${apiKey}&geometries=geojson`;
    
    const directionsResponse = await fetch(directionsUrl);
    
    if (!directionsResponse.ok) {
      const errorData = await directionsResponse.json().catch(() => null);
      const errorMessage = errorData?.message || `Mapbox Directions API error: ${directionsResponse.status}`;
      return {
        success: false,
        error: errorMessage
      };
    }

    const directionsResult = await directionsResponse.json();
    
    if (!directionsResult.routes || directionsResult.routes.length === 0) {
      return {
        success: false,
        error: 'No route found between the provided coordinates'
      };
    }

    // Get the route geometry
    const routeGeometry = directionsResult.routes[0].geometry;
    
    // Encode the route as a path for the static image
    const routePath = encodeURIComponent(JSON.stringify(routeGeometry));
    
    // Build the static image URL with route overlay
    const imageUrl = `https://api.mapbox.com/styles/v1/mapbox/${style}/static/path-5+0074D9-0.8(${routePath})/${sourceMarker},${destMarker}/auto/${width}x${height}?access_token=${apiKey}`;
    
    if (!returnBuffer) {
      return {
        success: true,
        imageUrl: imageUrl
      };
    }

    // Fetch the image as buffer
    const imageResponse = await fetch(imageUrl);
    
    if (!imageResponse.ok) {
      return {
        success: false,
        error: `Failed to fetch route image: ${imageResponse.status}`
      };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    
    console.log('Route image generated successfully');
    
    return {
      success: true,
      imageUrl: imageUrl,
      imageBuffer: imageBuffer
    };

  } catch (error) {
    const errorMessage = `Mapbox route image generation error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Convenience function to geocode two addresses and generate a route image
 * @param sourceAddress - Source address string
 * @param destinationAddress - Destination address string
 * @param options - Optional parameters for image generation
 * @returns Promise<RouteImageResult> - Result containing image URL or buffer
 */
export async function generateRouteFromAddresses(
  sourceAddress: string,
  destinationAddress: string,
  options: {
    width?: number;
    height?: number;
    returnBuffer?: boolean;
    zoom?: number;
    style?: string;
  } = {}
): Promise<RouteImageResult> {
  try {
    // Geocode both addresses
    const [sourceResult, destResult] = await Promise.all([
      geocodeAddress(sourceAddress),
      geocodeAddress(destinationAddress)
    ]);

    if (!sourceResult.success) {
      return {
        success: false,
        error: `Failed to geocode source address: ${sourceResult.error}`
      };
    }

    if (!destResult.success) {
      return {
        success: false,
        error: `Failed to geocode destination address: ${destResult.error}`
      };
    }

    // Generate route image using coordinates
    return await generateRouteImage(
      sourceResult.coordinates!,
      destResult.coordinates!,
      options
    );

  } catch (error) {
    const errorMessage = `Route generation from addresses error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
} 