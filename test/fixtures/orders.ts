/**
 * Orders as the Swell API returned them on 2026-10-10 from a store with prices before tax,
 * trimmed to the fields the app reads. Their Lexware invoices are known: see the tests.
 */

export const mixedRates = {
  "id": "6ac9df9885d66f001218688a",
  "number": "100302",
  "currency": "EUR",
  "account_id": "6ac9df62abea6d001252f160",
  "sub_total": 87.96,
  "discount_total": 0,
  "shipment_price": 4.9,
  "shipment_total": 4.9,
  "shipment_tax": 0.931,
  "item_tax": 15.1536,
  "tax_total": 16.0846,
  "grand_total": 108.94,
  "payment_total": 0,
  "paid": false,
  "taxes": [
    {
      "id": "vat_standard",
      "name": "USt 19 %",
      "priority": 1,
      "rate": 19,
      "amount": 15.1753,
      "shipping": true
    },
    {
      "id": "vat_reduced",
      "name": "USt 7 %",
      "priority": 1,
      "rate": 7,
      "amount": 0.9093
    }
  ],
  "billing": {
    "name": "Erika Musterfrau",
    "address1": "Hauptstr. 5",
    "address2": "2. OG",
    "city": "München",
    "zip": "80331",
    "country": "DE",
    "method": "cash",
    "first_name": "Erika",
    "last_name": "Musterfrau"
  },
  "shipping": {
    "name": "Erika Musterfrau",
    "address1": "Hauptstr. 5",
    "address2": "2. OG",
    "city": "München",
    "zip": "80331",
    "country": "DE",
    "service": "standard",
    "service_name": "DHL Paket",
    "price": 4.9,
    "first_name": "Erika",
    "last_name": "Musterfrau"
  },
  "date_created": "2026-10-10T06:47:52.656Z",
  "items": [
    {
      "id": "6ac9df9885d66f0012186886",
      "product_id": "6ac9df39a23ef10011a8c198",
      "product_name": "Lexware Test T-Shirt",
      "quantity": 3,
      "price": 24.99,
      "price_total": 74.97,
      "discount_total": 0,
      "tax_total": 14.2443,
      "taxes": [
        {
          "id": "vat_standard",
          "amount": 14.2443
        }
      ],
      "delivery": "shipment"
    },
    {
      "id": "6ac9df9885d66f0012186887",
      "product_id": "6ac9df3a193b18001294d0c5",
      "product_name": "Lexware Test Buch",
      "quantity": 1,
      "price": 12.99,
      "price_total": 12.99,
      "discount_total": 0,
      "tax_total": 0.9093,
      "taxes": [
        {
          "id": "vat_reduced",
          "amount": 0.9093
        }
      ],
      "delivery": "shipment"
    }
  ],
  "account": {
    "id": "6ac9df62abea6d001252f160",
    "email": "lexware-test-de@example.com",
    "name": "Erika Musterfrau",
    "first_name": "Erika",
    "last_name": "Musterfrau",
    "type": "individual"
  }
};

export const withCoupon = {
  "id": "6ac9df9a737a9b0012057cac",
  "number": "100303",
  "currency": "EUR",
  "account_id": "6ac9df62abea6d001252f160",
  "sub_total": 87.96,
  "discount_total": 8.796,
  "shipment_price": 4.9,
  "shipment_total": 4.9,
  "shipment_tax": 0.931,
  "item_tax": 13.6383,
  "tax_total": 14.5693,
  "grand_total": 98.63,
  "payment_total": 98.63,
  "paid": true,
  "taxes": [
    {
      "id": "vat_standard",
      "name": "USt 19 %",
      "priority": 1,
      "rate": 19,
      "amount": 13.7509,
      "shipping": true
    },
    {
      "id": "vat_reduced",
      "name": "USt 7 %",
      "priority": 1,
      "rate": 7,
      "amount": 0.8184
    }
  ],
  "billing": {
    "name": "Erika Musterfrau",
    "address1": "Hauptstr. 5",
    "address2": "2. OG",
    "city": "München",
    "zip": "80331",
    "country": "DE",
    "method": "cash",
    "first_name": "Erika",
    "last_name": "Musterfrau"
  },
  "shipping": {
    "name": "Erika Musterfrau",
    "address1": "Hauptstr. 5",
    "address2": "2. OG",
    "city": "München",
    "zip": "80331",
    "country": "DE",
    "service": "standard",
    "service_name": "DHL Paket",
    "price": 4.9,
    "first_name": "Erika",
    "last_name": "Musterfrau",
    "account_address_id": "6ac9e27cf785d400128e7f2c"
  },
  "date_created": "2026-10-10T06:47:54.692Z",
  "coupon_code": "LEXTEST10",
  "items": [
    {
      "id": "6ac9df9a737a9b0012057ca7",
      "product_id": "6ac9df39a23ef10011a8c198",
      "product_name": "Lexware Test T-Shirt",
      "quantity": 3,
      "price": 24.99,
      "price_total": 74.97,
      "discount_total": 7.497,
      "tax_total": 12.8199,
      "taxes": [
        {
          "id": "vat_standard",
          "amount": 12.8199
        }
      ],
      "delivery": "shipment"
    },
    {
      "id": "6ac9df9a737a9b0012057ca8",
      "product_id": "6ac9df3a193b18001294d0c5",
      "product_name": "Lexware Test Buch",
      "quantity": 1,
      "price": 12.99,
      "price_total": 12.99,
      "discount_total": 1.299,
      "tax_total": 0.8184,
      "taxes": [
        {
          "id": "vat_reduced",
          "amount": 0.8184
        }
      ],
      "delivery": "shipment"
    }
  ],
  "account": {
    "id": "6ac9df62abea6d001252f160",
    "email": "lexware-test-de@example.com",
    "name": "Erika Musterfrau",
    "first_name": "Erika",
    "last_name": "Musterfrau",
    "type": "individual"
  }
};

export const singleRate = {
  "id": "6ac9e3284a8140001216ba90",
  "number": "100304",
  "currency": "EUR",
  "account_id": "6ac9df62abea6d001252f160",
  "sub_total": 59.48,
  "discount_total": 0,
  "shipment_price": 4.9,
  "shipment_total": 4.9,
  "shipment_tax": 0.931,
  "item_tax": 11.3012,
  "tax_total": 12.2322,
  "grand_total": 76.61,
  "payment_total": 76.61,
  "paid": true,
  "taxes": [
    {
      "id": "vat_standard",
      "name": "USt 19 %",
      "priority": 1,
      "rate": 19,
      "amount": 12.2322,
      "shipping": true
    }
  ],
  "billing": {
    "name": "Erika Musterfrau",
    "address1": "Hauptstr. 5",
    "address2": "2. OG",
    "city": "München",
    "zip": "80331",
    "country": "DE",
    "method": "cash",
    "first_name": "Erika",
    "last_name": "Musterfrau"
  },
  "shipping": {
    "name": "Erika Musterfrau",
    "address1": "Hauptstr. 5",
    "address2": "2. OG",
    "city": "München",
    "zip": "80331",
    "country": "DE",
    "service": "standard",
    "service_name": "DHL Paket",
    "price": 4.9,
    "first_name": "Erika",
    "last_name": "Musterfrau",
    "account_address_id": "6ac9e27cf785d400128e7f2c"
  },
  "date_created": "2026-10-10T07:03:04.729Z",
  "items": [
    {
      "id": "6ac9e3284a8140001216ba86",
      "product_id": "6ac9df39a23ef10011a8c198",
      "product_name": "Lexware Test T-Shirt",
      "quantity": 2,
      "price": 24.99,
      "price_total": 49.98,
      "discount_total": 0,
      "tax_total": 9.4962,
      "taxes": [
        {
          "id": "vat_standard",
          "amount": 9.4962
        }
      ],
      "delivery": "shipment"
    },
    {
      "id": "6ac9e3284a8140001216ba87",
      "product_id": "6ac9df3ce88a4c001128e487",
      "product_name": "Lexware Test E-Book",
      "quantity": 1,
      "price": 9.5,
      "price_total": 9.5,
      "discount_total": 0,
      "tax_total": 1.805,
      "taxes": [
        {
          "id": "vat_standard",
          "amount": 1.805
        }
      ]
    }
  ],
  "account": {
    "id": "6ac9df62abea6d001252f160",
    "email": "lexware-test-de@example.com",
    "name": "Erika Musterfrau",
    "first_name": "Erika",
    "last_name": "Musterfrau",
    "type": "individual"
  }
};

export const frenchConsumer = {
  "id": "6ac9e4f45928130013716030",
  "number": "100307",
  "currency": "EUR",
  "account_id": "6ac9e4f45928130013716036",
  "sub_total": 62.97,
  "discount_total": 0,
  "shipment_price": 9.9,
  "shipment_total": 9.9,
  "shipment_tax": 1.98,
  "item_tax": 10.7105,
  "tax_total": 12.6905,
  "grand_total": 85.56,
  "payment_total": 85.56,
  "paid": true,
  "taxes": [
    {
      "id": "vat_standard",
      "name": "TVA 20 %",
      "priority": 1,
      "rate": 20,
      "amount": 11.976,
      "shipping": true
    },
    {
      "id": "vat_reduced",
      "name": "TVA 5,5 %",
      "priority": 1,
      "rate": 5.5,
      "amount": 0.7145
    }
  ],
  "billing": {
    "name": "Jean Dupont",
    "address1": "1 Rue de Rivoli",
    "city": "Paris",
    "zip": "75001",
    "country": "FR",
    "method": "cash",
    "first_name": "Jean",
    "last_name": "Dupont"
  },
  "shipping": {
    "name": "Jean Dupont",
    "address1": "1 Rue de Rivoli",
    "city": "Paris",
    "zip": "75001",
    "country": "FR",
    "service": "standard",
    "service_name": "DHL Paket International",
    "price": 9.9,
    "first_name": "Jean",
    "last_name": "Dupont",
    "account_address_id": "6ac9e525626ba90011f492f9"
  },
  "date_created": "2026-10-10T07:10:44.551Z",
  "items": [
    {
      "id": "6ac9e4f35928130013716026",
      "product_id": "6ac9df39a23ef10011a8c198",
      "product_name": "Lexware Test T-Shirt",
      "quantity": 2,
      "price": 24.99,
      "price_total": 49.98,
      "discount_total": 0,
      "tax_total": 9.996,
      "taxes": [
        {
          "id": "vat_standard",
          "amount": 9.996
        }
      ],
      "delivery": "shipment"
    },
    {
      "id": "6ac9e4f35928130013716027",
      "product_id": "6ac9df3a193b18001294d0c5",
      "product_name": "Lexware Test Buch",
      "quantity": 1,
      "price": 12.99,
      "price_total": 12.99,
      "discount_total": 0,
      "tax_total": 0.7145,
      "taxes": [
        {
          "id": "vat_reduced",
          "amount": 0.7145
        }
      ],
      "delivery": "shipment"
    }
  ],
  "account": {
    "id": "6ac9e4f45928130013716036",
    "email": "lexware-test-fr@example.com",
    "name": "Jean Dupont",
    "first_name": "Jean",
    "last_name": "Dupont",
    "type": "individual"
  }
};

export const swissExport = {
  "id": "6ac9e4f75e50a60012942768",
  "number": "100308",
  "currency": "EUR",
  "account_id": "6ac9e4f75e50a6001294276d",
  "sub_total": 62.97,
  "discount_total": 0,
  "shipment_price": 9.9,
  "shipment_total": 9.9,
  "item_tax": 0,
  "tax_total": 0,
  "grand_total": 72.87,
  "payment_total": 72.87,
  "paid": true,
  "billing": {
    "name": "Hans Muster",
    "address1": "Bahnhofstr. 1",
    "city": "Zürich",
    "zip": "8001",
    "country": "CH",
    "method": "cash",
    "first_name": "Hans",
    "last_name": "Muster"
  },
  "shipping": {
    "name": "Hans Muster",
    "address1": "Bahnhofstr. 1",
    "city": "Zürich",
    "zip": "8001",
    "country": "CH",
    "service": "standard",
    "service_name": "DHL Paket International",
    "price": 9.9,
    "first_name": "Hans",
    "last_name": "Muster",
    "account_address_id": "6ac9e52b8039d90013cccebd"
  },
  "date_created": "2026-10-10T07:10:47.502Z",
  "items": [
    {
      "id": "6ac9e4f65e50a6001294275e",
      "product_id": "6ac9df39a23ef10011a8c198",
      "product_name": "Lexware Test T-Shirt",
      "quantity": 2,
      "price": 24.99,
      "price_total": 49.98,
      "discount_total": 0,
      "tax_total": 0,
      "delivery": "shipment"
    },
    {
      "id": "6ac9e4f65e50a6001294275f",
      "product_id": "6ac9df3a193b18001294d0c5",
      "product_name": "Lexware Test Buch",
      "quantity": 1,
      "price": 12.99,
      "price_total": 12.99,
      "discount_total": 0,
      "tax_total": 0,
      "delivery": "shipment"
    }
  ],
  "account": {
    "id": "6ac9e4f75e50a6001294276d",
    "email": "lexware-test-ch@example.com",
    "name": "Hans Muster",
    "first_name": "Hans",
    "last_name": "Muster",
    "type": "individual"
  }
};

export const belgianBusiness = {
  "id": "6ac9e4fa48730e0012b7e3ff",
  "number": "100309",
  "currency": "EUR",
  "account_id": "6ac9e4fa48730e0012b7e404",
  "sub_total": 62.97,
  "discount_total": 0,
  "shipment_price": 9.9,
  "shipment_total": 9.9,
  "item_tax": 0,
  "tax_total": 0,
  "grand_total": 72.87,
  "payment_total": 72.87,
  "paid": true,
  "billing": {
    "name": "Anna Peeters",
    "address1": "Wetstraat 1",
    "city": "Brussel",
    "zip": "1000",
    "country": "BE",
    "company": "Peeters BV",
    "method": "cash",
    "vat_number": "BE0123456789",
    "first_name": "Anna",
    "last_name": "Peeters"
  },
  "shipping": {
    "name": "Anna Peeters",
    "address1": "Wetstraat 1",
    "city": "Brussel",
    "zip": "1000",
    "country": "BE",
    "company": "Peeters BV",
    "service": "standard",
    "service_name": "DHL Paket International",
    "price": 9.9,
    "first_name": "Anna",
    "last_name": "Peeters",
    "account_address_id": "6ac9e532a165a50011899175"
  },
  "date_created": "2026-10-10T07:10:51.267Z",
  "items": [
    {
      "id": "6ac9e4fa48730e0012b7e3f4",
      "product_id": "6ac9df39a23ef10011a8c198",
      "product_name": "Lexware Test T-Shirt",
      "quantity": 2,
      "price": 24.99,
      "price_total": 49.98,
      "discount_total": 0,
      "tax_total": 0,
      "delivery": "shipment"
    },
    {
      "id": "6ac9e4fa48730e0012b7e3f5",
      "product_id": "6ac9df3a193b18001294d0c5",
      "product_name": "Lexware Test Buch",
      "quantity": 1,
      "price": 12.99,
      "price_total": 12.99,
      "discount_total": 0,
      "tax_total": 0,
      "delivery": "shipment"
    }
  ],
  "account": {
    "id": "6ac9e4fa48730e0012b7e404",
    "email": "lexware-test-be@example.com",
    "name": "Anna Peeters",
    "first_name": "Anna",
    "last_name": "Peeters",
    "type": "individual"
  }
};

export const doubleTaxed = {
  "id": "6ac9df61abea6d001252f157",
  "number": "100301",
  "currency": "EUR",
  "account_id": "6ac9df62abea6d001252f160",
  "sub_total": 87.96,
  "discount_total": 0,
  "shipment_price": 4.9,
  "shipment_total": 4.9,
  "shipment_tax": 0.931,
  "item_tax": 17.6217,
  "tax_total": 18.5527,
  "grand_total": 111.41,
  "payment_total": 0,
  "paid": false,
  "taxes": [
    {
      "id": "vat_standard",
      "name": "USt 19 %",
      "priority": 1,
      "rate": 19,
      "amount": 17.6434,
      "shipping": true
    },
    {
      "id": "vat_reduced",
      "name": "USt 7 %",
      "priority": 1,
      "rate": 7,
      "amount": 0.9093
    }
  ],
  "billing": {
    "name": "Erika Musterfrau",
    "address1": "Hauptstr. 5",
    "address2": "2. OG",
    "city": "München",
    "zip": "80331",
    "country": "DE",
    "method": "cash",
    "first_name": "Erika",
    "last_name": "Musterfrau"
  },
  "shipping": {
    "name": "Erika Musterfrau",
    "address1": "Hauptstr. 5",
    "address2": "2. OG",
    "city": "München",
    "zip": "80331",
    "country": "DE",
    "service": "standard",
    "service_name": "DHL Paket",
    "price": 4.9,
    "first_name": "Erika",
    "last_name": "Musterfrau"
  },
  "date_created": "2026-10-10T06:46:58.300Z",
  "items": [
    {
      "id": "6ac9df61abea6d001252f14c",
      "product_id": "6ac9df39a23ef10011a8c198",
      "product_name": "Lexware Test T-Shirt",
      "quantity": 3,
      "price": 24.99,
      "price_total": 74.97,
      "discount_total": 0,
      "tax_total": 14.2443,
      "taxes": [
        {
          "id": "vat_standard",
          "amount": 14.2443
        }
      ],
      "delivery": "shipment"
    },
    {
      "id": "6ac9df61abea6d001252f14d",
      "product_id": "6ac9df3a193b18001294d0c5",
      "product_name": "Lexware Test Buch",
      "quantity": 1,
      "price": 12.99,
      "price_total": 12.99,
      "discount_total": 0,
      "tax_total": 3.3774,
      "taxes": [
        {
          "id": "vat_standard",
          "amount": 2.4681
        },
        {
          "id": "vat_reduced",
          "amount": 0.9093
        }
      ],
      "delivery": "shipment"
    }
  ],
  "account": {
    "id": "6ac9df62abea6d001252f160",
    "email": "lexware-test-de@example.com",
    "name": "Erika Musterfrau",
    "first_name": "Erika",
    "last_name": "Musterfrau",
    "type": "individual"
  }
};

