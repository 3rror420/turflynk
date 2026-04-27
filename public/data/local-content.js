(function () {
  const cityFaqs = (city) => [
    {
      question: `Do I need an account to get a lawn care estimate in ${city}?`,
      answer: 'No. You can enter an address, review the mowable area, and see an estimate before creating an account.'
    },
    {
      question: 'Can I adjust the mowable area before pricing?',
      answer: 'Yes. MowNWA lets you use the parcel shape, draw a custom area, edit vertices, and remove non-mowable sections.'
    },
    {
      question: 'Are estimates final prices?',
      answer: 'Estimates are a starting point based on property details and selected services. Availability and final pricing may vary by location and job details.'
    },
    {
      question: `What services can I request around ${city}?`,
      answer: 'Common requests include mowing, edging, trimming, leaf cleanup, yard cleanup, hedge trimming, and seasonal lawn care.'
    }
  ];

  const cityServices = [
    'Lawn mowing',
    'Lawn edging',
    'Weed eating / string trimming',
    'Leaf cleanup',
    'Yard cleanup',
    'Recurring lawn care'
  ];

  const cityRecords = [
    ['fayetteville', 'Fayetteville', 'Washington', ['Johnson', 'Farmington', 'Greenland', 'Elkins', 'Springdale'], 'college rentals, hillside lots, older neighborhoods, and busy family yards'],
    ['springdale', 'Springdale', 'Washington and Benton', ['Lowell', 'Johnson', 'Tontitown', 'Rogers', 'Fayetteville'], 'established subdivisions, commercial corridors, and fast-growing residential areas'],
    ['rogers', 'Rogers', 'Benton', ['Lowell', 'Bentonville', 'Cave Springs', 'Avoca', 'Springdale'], 'suburban lawns, lake-area properties, and neighborhoods with regular edging needs'],
    ['bentonville', 'Bentonville', 'Benton', ['Centerton', 'Rogers', 'Cave Springs', 'Bella Vista', 'Pea Ridge'], 'newer subdivisions, compact city lots, and homes with detailed front-yard presentation'],
    ['bella-vista', 'Bella Vista', 'Benton', ['Bentonville', 'Pea Ridge', 'Gravette', 'Centerton', 'Rogers'], 'tree cover, slopes, leaf cleanup, and lake-area access considerations'],
    ['lowell', 'Lowell', 'Benton', ['Rogers', 'Springdale', 'Cave Springs', 'Bethel Heights'], 'commuter neighborhoods, subdivision lawns, and routine mowing routes'],
    ['johnson', 'Johnson', 'Washington', ['Fayetteville', 'Springdale', 'Tontitown', 'Lowell'], 'smaller residential lots, tight access, and quick-turn mowing needs'],
    ['farmington', 'Farmington', 'Washington', ['Fayetteville', 'Prairie Grove', 'Greenland', 'Lincoln'], 'larger lots, newer homes, and edge maintenance along drives and sidewalks'],
    ['prairie-grove', 'Prairie Grove', 'Washington', ['Farmington', 'Lincoln', 'Fayetteville', 'Canehill'], 'larger residential yards, seasonal growth, and one-time cleanup requests'],
    ['siloam-springs', 'Siloam Springs', 'Benton', ['Gentry', 'Decatur', 'Highfill', 'Cave Springs'], 'west Benton County yards, recurring mowing, and seasonal leaf cleanup'],
    ['centerton', 'Centerton', 'Benton', ['Bentonville', 'Gravette', 'Highfill', 'Cave Springs'], 'rapidly growing subdivisions, fenced yards, and regular mowing schedules'],
    ['cave-springs', 'Cave Springs', 'Benton', ['Bentonville', 'Rogers', 'Lowell', 'Highfill'], 'new subdivisions, larger lots, and properties where parcel boundaries may need adjustment'],
    ['pea-ridge', 'Pea Ridge', 'Benton', ['Bella Vista', 'Bentonville', 'Avoca', 'Garfield'], 'growing neighborhoods, larger lawns, and seasonal yard cleanup'],
    ['tontitown', 'Tontitown', 'Washington', ['Springdale', 'Johnson', 'Elm Springs', 'Fayetteville'], 'mixed residential lots, newer development, and mowing plus edging requests'],
    ['elkins', 'Elkins', 'Washington', ['Fayetteville', 'Goshen', 'Greenland', 'Wesley'], 'larger yards, rural edges, and seasonal grass growth'],
    ['greenland', 'Greenland', 'Washington', ['Fayetteville', 'West Fork', 'Farmington', 'Elkins'], 'small-town lawns, sloped yards, and one-time mowing requests'],
    ['west-fork', 'West Fork', 'Washington', ['Greenland', 'Winslow', 'Fayetteville', 'Prairie Grove'], 'valley lots, slopes, and cleanup after fast seasonal growth']
  ];

  const cities = cityRecords.map(([slug, name, county, nearby, notes]) => ({
    slug,
    name,
    state: 'AR',
    regionName: 'Northwest Arkansas',
    county: county.includes(' and ') ? undefined : `${county} County`,
    counties: county.includes(' and ') ? county.split(' and ').map((item) => `${item} County`) : [`${county} County`],
    shortDescription: `MowNWA helps customers request lawn care estimates in ${name} and nearby Northwest Arkansas areas.`,
    heroTitle: `Lawn care estimates in ${name}, Arkansas`,
    heroSubtitle: `Enter your address, confirm the mowable area, and review a lawn care estimate before deciding whether to continue.`,
    serviceSummary: `${name} customers can use TurfLynk for mowing estimates, edging, trimming, cleanup, and other common yard work. Availability, pricing, and service coverage may vary by property and provider availability.`,
    commonServices: cityServices,
    neighborhoodsOrNearbyAreas: nearby,
    localNotes: `Common ${name} lawn care needs include ${notes}. The map editor helps adjust parcel outlines when only part of a property should be mowed.`,
    ctaText: 'Get a lawn mowing estimate',
    faqs: cityFaqs(name),
    seoTitle: `Lawn care estimates in ${name}, AR | MowNWA`,
    seoDescription: `Request a lawn care estimate in ${name}, Arkansas. Map your mowable area and review pricing before continuing.`
  }));

  const areaFaqs = (areaName) => [
    {
      question: `Can I get an estimate in ${areaName} without creating an account?`,
      answer: 'Yes. You can review an initial estimate before logging in or signing up.'
    },
    {
      question: `Which lawn care services are common in ${areaName}?`,
      answer: 'Common requests include mowing, edging, string trimming, leaf cleanup, yard cleanup, hedge trimming, mulch, and seasonal cleanup.'
    },
    {
      question: 'Does TurfLynk show a final guaranteed price?',
      answer: 'The estimate is a starting point based on selected services and mapped yard details. Final pricing and availability may vary by property and provider availability.'
    },
    {
      question: 'Can I use the map tools for only part of a property?',
      answer: 'Yes. You can adjust the mowable area, draw a custom area, or remove sections such as buildings, driveways, beds, and wooded areas.'
    }
  ];

  const areaRecords = [
    {
      slug: 'northwest-arkansas',
      name: 'Northwest Arkansas',
      counties: ['Benton County', 'Washington County'],
      nearby: ['Fayetteville', 'Springdale', 'Rogers', 'Bentonville', 'Bella Vista', 'Siloam Springs'],
      notes: 'Northwest Arkansas has a mix of college rentals, newer subdivisions, tree-covered lots, and fast-growing neighborhoods where mowing needs can change quickly through the season.'
    },
    {
      slug: 'benton-county',
      name: 'Benton County',
      counties: ['Benton County'],
      nearby: ['Bentonville', 'Rogers', 'Bella Vista', 'Centerton', 'Cave Springs', 'Pea Ridge', 'Lowell', 'Siloam Springs'],
      notes: 'Benton County requests often include subdivision mowing, edging along sidewalks and drives, leaf cleanup near shaded lots, and one-time cleanup for move-ins or listings.'
    },
    {
      slug: 'washington-county',
      name: 'Washington County',
      counties: ['Washington County'],
      nearby: ['Fayetteville', 'Springdale', 'Farmington', 'Prairie Grove', 'Johnson', 'Tontitown', 'Elkins', 'Greenland', 'West Fork'],
      notes: 'Washington County yards can include hillside lots, older neighborhoods, fenced backyards, rural edges, and seasonal growth that may need trimming or cleanup beyond a standard mow.'
    }
  ];

  const areas = areaRecords.map((area) => ({
    slug: area.slug,
    name: area.name,
    state: 'AR',
    regionName: 'Arkansas service area',
    counties: area.counties,
    shortDescription: `MowNWA helps customers request lawn care estimates across ${area.name}.`,
    heroTitle: `Lawn care estimates in ${area.name}`,
    heroSubtitle: 'Map your mowable area, choose the service you need, and review a starting estimate before deciding whether to continue.',
    serviceSummary: `Customers in ${area.name} can use TurfLynk for mowing estimates, trimming, cleanup, and other common yard care requests. Availability, pricing, and coverage may vary by location.`,
    commonServices: cityServices,
    neighborhoodsOrNearbyAreas: area.nearby,
    localNotes: area.notes,
    ctaText: 'Get a lawn care estimate',
    faqs: areaFaqs(area.name),
    seoTitle: `Lawn care estimates in ${area.name} | MowNWA`,
    seoDescription: `Request lawn care estimates in ${area.name}. Map your yard and review pricing before continuing.`
  }));

  const serviceFaqs = (serviceName) => [
    {
      question: `Do I need an account to estimate ${serviceName.toLowerCase()}?`,
      answer: 'No. You can get an initial estimate before logging in or signing up.'
    },
    {
      question: 'What affects the estimate?',
      answer: 'Property size, mowable area, service type, access, obstacles, slopes, cleanup needs, and local availability can affect pricing.'
    },
    {
      question: 'Can I change the mapped area?',
      answer: 'Yes. You can use a parcel shape, draw your own area, edit it, or cut out areas that should not be included.'
    },
    {
      question: 'Is service available everywhere in Arkansas?',
      answer: 'TurfLynk is starting with Arkansas and Northwest Arkansas content. Coverage and provider availability may vary by location.'
    }
  ];

  const services = [
    {
      slug: 'lawn-mowing',
      name: 'Lawn mowing',
      shortDescription: 'Estimate routine mowing based on your address, parcel, and mowable area.',
      whatIsIncluded: ['Mowing accessible turf areas', 'Reviewing mowable square footage', 'Optional trimming or edging when selected'],
      bestFor: ['Routine home lawn care', 'Rental properties', 'One-time catch-up mowing'],
      whenNeeded: 'Useful when grass is actively growing, before a rental turnover, or when you want a quick starting price before requesting service.',
      priceFactors: ['Mowable square footage', 'Grass height and growth rate', 'Slope, gates, obstacles, and access'],
      estimateNotes: 'Mowing estimates depend heavily on mowable square footage, access, slope, and whether the lawn is overgrown.'
    },
    {
      slug: 'lawn-edging',
      name: 'Lawn edging',
      shortDescription: 'Add cleaner borders along sidewalks, drives, curbs, and walkways.',
      whatIsIncluded: ['Straightening turf edges where accessible', 'Driveway and sidewalk border cleanup', 'Blowing off hard surfaces when part of the job'],
      bestFor: ['Homes with sidewalks', 'Corner lots', 'Front-yard curb appeal'],
      whenNeeded: 'Helpful when turf has grown over hard edges or when a front yard needs a cleaner finished look.',
      priceFactors: ['Length of sidewalks and driveways', 'Corner-lot exposure', 'How overgrown the edges are'],
      estimateNotes: 'Edging can vary by sidewalk length, corner-lot exposure, and how overgrown the edges are.'
    },
    {
      slug: 'weed-eating-string-trimming',
      name: 'Weed eating / string trimming',
      shortDescription: 'Estimate trimming around fences, posts, beds, trees, and tight areas.',
      whatIsIncluded: ['Trimming around common obstacles', 'Fence-line and border trimming where accessible', 'Touch-up work around areas a mower cannot reach'],
      bestFor: ['Fenced backyards', 'Sloped edges', 'Properties with trees or landscaping'],
      whenNeeded: 'Useful when fence lines, posts, trees, beds, or slopes need detail work beyond mower passes.',
      priceFactors: ['Fence length', 'Number of obstacles', 'Vegetation density and access'],
      estimateNotes: 'Trim time can change with fence length, obstacles, gates, and dense vegetation.'
    },
    {
      slug: 'leaf-cleanup',
      name: 'Leaf cleanup',
      shortDescription: 'Request seasonal cleanup for leaves in lawn areas and accessible beds.',
      whatIsIncluded: ['Leaf gathering or blowoff in accessible areas', 'Cleanup around lawn edges', 'Optional haul-off depending on provider availability'],
      bestFor: ['Tree-covered yards', 'Fall cleanup', 'Bella Vista and older shaded neighborhoods'],
      whenNeeded: 'Best during fall leaf season, after windy weather, or before mowing a yard with heavy leaf cover.',
      priceFactors: ['Leaf volume', 'Wet or packed leaves', 'Tree cover and haul-off needs'],
      estimateNotes: 'Leaf volume, wet leaves, tree cover, and haul-off needs can change the final price.'
    },
    {
      slug: 'yard-cleanup',
      name: 'Yard cleanup',
      shortDescription: 'Estimate general cleanup for yards that need more than a standard mow.',
      whatIsIncluded: ['Basic debris cleanup', 'Overgrowth notes', 'Mowing or trimming when selected'],
      bestFor: ['Move-outs', 'Rental turnover', 'Overgrown yards'],
      whenNeeded: 'Useful after a move-out, before listing a home, or when a yard has fallen behind regular maintenance.',
      priceFactors: ['Debris amount', 'Overgrowth', 'Hauling needs and property access'],
      estimateNotes: 'Cleanup estimates depend on debris amount, overgrowth, access, and whether hauling is needed.'
    },
    {
      slug: 'bush-hedge-trimming',
      name: 'Bush / hedge trimming',
      shortDescription: 'Request trimming for shrubs, hedges, and light landscape shaping.',
      whatIsIncluded: ['Basic hedge shaping', 'Shrub trimming where reachable', 'Cleanup notes for clippings'],
      bestFor: ['Front beds', 'Walkway clearance', 'Seasonal shape-up work'],
      whenNeeded: 'Good for shrubs blocking walkways, hedges losing shape, or visible beds that need a seasonal trim.',
      priceFactors: ['Shrub height and density', 'Reachability', 'Clipping cleanup or haul-off'],
      estimateNotes: 'Height, density, access, and disposal needs can affect price.'
    },
    {
      slug: 'mulch-installation',
      name: 'Mulch installation',
      shortDescription: 'Plan mulch refreshes for beds, trees, and visible landscape areas.',
      whatIsIncluded: ['Mulch area review', 'Material and access notes', 'Installation request details'],
      bestFor: ['Spring refreshes', 'Curb appeal', 'Landscape bed cleanup'],
      whenNeeded: 'Often requested in spring, before listing a home, or after bed cleanup when mulch has thinned or faded.',
      priceFactors: ['Bed size', 'Mulch type and depth', 'Prep work and material delivery'],
      estimateNotes: 'Mulch type, bed size, prep needs, and material delivery affect pricing.'
    },
    {
      slug: 'seasonal-cleanup',
      name: 'Seasonal cleanup',
      shortDescription: 'Prepare the yard for spring growth, summer maintenance, or fall leaf season.',
      whatIsIncluded: ['Seasonal yard assessment', 'Cleanup request notes', 'Mowing, trimming, or leaf cleanup when selected'],
      bestFor: ['Spring growth', 'Fall leaves', 'Pre-listing cleanup'],
      whenNeeded: 'Useful before spring growth, after summer overgrowth, during fall leaves, or before an event or listing.',
      priceFactors: ['Seasonal timing', 'Yard condition', 'Selected cleanup and mowing tasks'],
      estimateNotes: 'Seasonal cleanup varies by timing, weather, growth, and yard condition.'
    },
    {
      slug: 'basic-landscaping',
      name: 'Basic landscaping',
      shortDescription: 'Request simple landscape maintenance and light improvement work.',
      whatIsIncluded: ['Basic bed cleanup notes', 'Light trimming or mulch-related requests', 'Provider follow-up for scope details'],
      bestFor: ['Small refresh projects', 'Maintenance touch-ups', 'Simple curb appeal work'],
      whenNeeded: 'Good for small bed refreshes, tidy-up work, or simple curb appeal tasks that are not full landscape construction.',
      priceFactors: ['Scope details', 'Materials', 'Prep work and provider availability'],
      estimateNotes: 'Landscaping scope can vary widely, so the estimate is a starting point for follow-up.'
    },
    {
      slug: 'recurring-lawn-care',
      name: 'Recurring lawn care',
      shortDescription: 'Start with an estimate for regular mowing and maintenance.',
      whatIsIncluded: ['Mowable area estimate', 'Recurring service request details', 'Optional edging and trimming notes'],
      bestFor: ['Busy homeowners', 'Rental properties', 'Consistent seasonal maintenance'],
      whenNeeded: 'Helpful when you want consistent maintenance during the growing season instead of requesting one visit at a time.',
      priceFactors: ['Visit frequency', 'Selected services', 'Growth rate and provider route availability'],
      estimateNotes: 'Recurring service depends on schedule, provider availability, lawn growth, and selected services.'
    },
    {
      slug: 'one-time-mowing',
      name: 'One-time mowing',
      shortDescription: 'Get an estimate for a single mowing visit without committing to recurring service.',
      whatIsIncluded: ['One-time mow request', 'Mowable area mapping', 'Access and overgrowth notes'],
      bestFor: ['Before events', 'Rental turnovers', 'Catch-up mowing'],
      whenNeeded: 'Useful before an event, after travel, during rental turnover, or any time you need one mowing visit.',
      priceFactors: ['Grass height', 'Mowable area', 'Access, trimming, and cleanup needs'],
      estimateNotes: 'One-time mowing may be affected by grass height, access, and whether trimming or cleanup is included.'
    }
  ].map((service) => ({
    ...service,
    heroTitle: `${service.name} estimates in Northwest Arkansas`,
    heroSubtitle: 'Use TurfLynk to map the property, review a starting estimate, and continue only when you are ready.',
    faqs: serviceFaqs(service.name),
    ctaText: 'Start an estimate',
    seoTitle: `${service.name} estimates in Northwest Arkansas | MowNWA`,
    seoDescription: `${service.name} estimates for Northwest Arkansas yards. Map the mowable area and review pricing before continuing.`
  }));

  window.TurfLynkLocalContent = {
    homepage: {
      heroTitle: 'Fast Lawn Mowing Quotes in Northwest Arkansas',
      heroSubtitle: 'Enter your address, estimate your yard, and request mowing or yard cleanup service in minutes. No account required to get a quote.',
      seoTitle: 'MowNWA | Fast Lawn Mowing Quotes in Northwest Arkansas',
      seoDescription: 'Get fast lawn mowing quotes in Northwest Arkansas. Enter your address, map your yard, and request mowing or cleanup service. Fayetteville, Springdale, Rogers, Bentonville, and surrounding areas.',
      howItWorks: [
        'Enter your address',
        'Confirm or adjust your mowable area',
        'Get an instant estimate',
        'Submit your service request — we follow up to schedule'
      ],
      customerProviderSummary: 'MowNWA connects Northwest Arkansas homeowners with local lawn care crews. Get a fast estimate without creating an account.',
      faqs: [
        {
          question: 'Do I need an account to get a lawn mowing quote?',
          answer: 'No. Enter your address and get an estimate instantly. You only need to provide contact info when you are ready to submit a service request.'
        },
        {
          question: 'What areas does MowNWA serve?',
          answer: 'We focus on Northwest Arkansas including Fayetteville, Springdale, Rogers, Bentonville, Bella Vista, Lowell, Centerton, Farmington, Prairie Grove, Siloam Springs, Cave Springs, Pea Ridge, Tontitown, Johnson, and Elkins.'
        },
        {
          question: 'How is the estimate calculated?',
          answer: 'The estimate uses your service type, mowable square footage from the map, and local pricing. Lot size comes from the Arkansas parcel data when available.'
        },
        {
          question: 'Can I adjust the mowable area before pricing?',
          answer: 'Yes. Use the Lasso Yard tool to draw the mowable area, or use the parcel outline and cut out driveways, buildings, and beds.'
        },
        {
          question: 'Are estimates final prices?',
          answer: 'Estimates are a starting point. Final pricing is confirmed when a crew follows up on your request.'
        },
        {
          question: 'What services are available?',
          answer: 'Mowing, edging, leaf cleanup, brush cleanup, yard cleanup, landscaping, hauling/debris removal, and more. Select the service type that fits your needs.'
        }
      ]
    },
    cities,
    areas,
    services
  };
})();
