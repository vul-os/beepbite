package chatbot

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/locations"
	"github.com/jackc/pgx/v5"
)

// Customer matches the rows we read from the customers table.
type Customer struct {
	ID             string     `json:"id"`
	WhatsappNumber string     `json:"whatsapp_number"`
	FirstName      *string    `json:"first_name"`
	LastName       *string    `json:"last_name"`
	Email          *string    `json:"email"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      *time.Time `json:"updated_at,omitempty"`
}

type CustomerAddress struct {
	ID                   string  `json:"id"`
	CustomerID           string  `json:"customer_id"`
	AddressLine1         *string `json:"address_line_1"`
	Latitude             *string `json:"latitude"`
	Longitude            *string `json:"longitude"`
	DeliveryInstructions *string `json:"delivery_instructions"`
	IsDefault            bool    `json:"is_default"`
}

type Location struct {
	ID                    string   `json:"id"`
	Name                  string   `json:"name"`
	Address               *string  `json:"address"`
	Latitude              *float64 `json:"latitude"`
	Longitude             *float64 `json:"longitude"`
	DeliveryFee           float64  `json:"delivery_fee"`
	FreeDeliveryThreshold float64  `json:"free_delivery_threshold"`
	IsActive              bool     `json:"is_active"`
}

type Category struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	Items       []Item  `json:"items"`
}

type Item struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Description     *string         `json:"description"`
	Price           float64         `json:"price"`
	PreparationTime *int            `json:"preparation_time"`
	ItemVariations  []ItemVariation `json:"item_variations"`
}

type ItemVariation struct {
	ID                   string                `json:"id"`
	Name                 string                `json:"name"`
	IsRequired           bool                  `json:"is_required"`
	ItemVariationOptions []ItemVariationOption `json:"item_variation_options"`
}

type ItemVariationOption struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	PriceModifier float64 `json:"price_modifier"`
}

type CartItem struct {
	ID                  string              `json:"id"`
	CustomerID          string              `json:"customer_id"`
	LocationID          string              `json:"location_id"`
	ItemID              string              `json:"item_id"`
	Quantity            int                 `json:"quantity"`
	UnitPrice           float64             `json:"unit_price"`
	TotalPrice          float64             `json:"total_price"`
	SpecialInstructions *string             `json:"special_instructions"`
	Items               *CartItemRef        `json:"items"`
	CartItemVariations  []CartItemVariation `json:"cart_item_variations"`
}

type CartItemRef struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	Price       float64 `json:"price"`
}

type CartItemVariation struct {
	ItemVariations       CartItemVariationName   `json:"item_variations"`
	ItemVariationOptions CartItemVariationOption `json:"item_variation_options"`
}

type CartItemVariationName struct {
	Name string `json:"name"`
}

type CartItemVariationOption struct {
	Name          string  `json:"name"`
	PriceModifier float64 `json:"price_modifier"`
}

type CartSummary struct {
	CustomerID        string  `json:"customer_id"`
	LocationID        string  `json:"location_id"`
	ItemCount         int     `json:"item_count"`
	TotalQuantity     int     `json:"total_quantity"`
	Subtotal          float64 `json:"subtotal"`
	DeliveryFee       float64 `json:"delivery_fee"`
	DeliveryFeeAmount float64 `json:"delivery_fee_amount"`
	TotalAmount       float64 `json:"total_amount"`
}

type OrderRef struct {
	ID          string            `json:"id"`
	OrderNumber string            `json:"order_number"`
	Status      string            `json:"status"`
	CreatedAt   time.Time         `json:"created_at"`
	Locations   *OrderLocationRef `json:"locations"`
}

type OrderLocationRef struct {
	Name string `json:"name"`
}

func (s *Service) getOrCreateCustomer(ctx context.Context, whatsappNumber string, displayName string) *Customer {
	normalizedNumber := whatsappNumber
	if strings.HasPrefix(normalizedNumber, "+") {
		normalizedNumber = normalizedNumber[1:]
	}

	existing := &Customer{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, whatsapp_number, first_name, last_name, email, created_at, updated_at
		 FROM customers WHERE whatsapp_number = $1`,
		normalizedNumber,
	).Scan(&existing.ID, &existing.WhatsappNumber, &existing.FirstName,
		&existing.LastName, &existing.Email, &existing.CreatedAt, &existing.UpdatedAt)

	if err == nil {
		// If existing customer has no first_name but displayName provided, update it.
		if (existing.FirstName == nil || *existing.FirstName == "") && displayName != "" {
			log.Printf("Updating customer %s with first_name: %s", existing.ID, displayName)
			updated := &Customer{}
			updErr := s.pool.QueryRow(ctx,
				`UPDATE customers SET first_name = $1, updated_at = NOW()
				 WHERE id = $2
				 RETURNING id, whatsapp_number, first_name, last_name, email, created_at, updated_at`,
				displayName, existing.ID,
			).Scan(&updated.ID, &updated.WhatsappNumber, &updated.FirstName,
				&updated.LastName, &updated.Email, &updated.CreatedAt, &updated.UpdatedAt)
			if updErr == nil {
				return updated
			}
			log.Printf("Error updating customer name: %v", updErr)
			return existing
		}
		return existing
	}

	if !errors.Is(err, pgx.ErrNoRows) {
		log.Printf("Error fetching customer: %v", err)
	}

	// Create new customer
	created := &Customer{}
	var firstName interface{}
	if displayName != "" {
		firstName = displayName
	} else {
		firstName = nil
	}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO customers (whatsapp_number, first_name, created_at, updated_at)
		 VALUES ($1, $2, NOW(), NOW())
		 RETURNING id, whatsapp_number, first_name, last_name, email, created_at, updated_at`,
		normalizedNumber, firstName,
	).Scan(&created.ID, &created.WhatsappNumber, &created.FirstName,
		&created.LastName, &created.Email, &created.CreatedAt, &created.UpdatedAt)
	if err != nil {
		log.Printf("Error creating customer: %v", err)
		return nil
	}
	return created
}

func (s *Service) getCustomerAddresses(ctx context.Context, customerID string) []CustomerAddress {
	rows, err := s.pool.Query(ctx,
		`SELECT id, customer_id, address_line_1, latitude::text, longitude::text,
		        delivery_instructions, is_default
		 FROM customer_addresses
		 WHERE customer_id = $1
		 ORDER BY is_default DESC, created_at DESC`,
		customerID,
	)
	if err != nil {
		log.Printf("Error getting customer addresses: %v", err)
		return nil
	}
	defer rows.Close()

	var addrs []CustomerAddress
	for rows.Next() {
		a := CustomerAddress{}
		if err := rows.Scan(&a.ID, &a.CustomerID, &a.AddressLine1, &a.Latitude,
			&a.Longitude, &a.DeliveryInstructions, &a.IsDefault); err != nil {
			log.Printf("Error scanning address: %v", err)
			continue
		}
		addrs = append(addrs, a)
	}
	return addrs
}

func (s *Service) getNearbyStores(ctx context.Context, latitude, longitude float64) []Location {
	const maxDistance = 10.0
	latDelta := maxDistance / 111.0
	lngDelta := maxDistance / (111.0 * math.Cos(latitude*math.Pi/180.0))

	rows, err := s.pool.Query(ctx,
		`SELECT id, name, address, latitude::float8, longitude::float8,
		        delivery_fee, free_delivery_threshold, is_active
		 FROM locations
		 WHERE latitude >= $1 AND latitude <= $2
		   AND longitude >= $3 AND longitude <= $4
		   AND is_active = true
		 ORDER BY name`,
		latitude-latDelta, latitude+latDelta,
		longitude-lngDelta, longitude+lngDelta,
	)
	if err != nil {
		log.Printf("Error getting nearby stores: %v", err)
		return nil
	}
	defer rows.Close()

	var stores []Location
	for rows.Next() {
		l := Location{}
		if err := rows.Scan(&l.ID, &l.Name, &l.Address, &l.Latitude, &l.Longitude,
			&l.DeliveryFee, &l.FreeDeliveryThreshold, &l.IsActive); err != nil {
			log.Printf("Error scanning location: %v", err)
			continue
		}
		stores = append(stores, l)
	}
	return stores
}

func (s *Service) getStoresBySearch(ctx context.Context, searchTerm string) []Location {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, address, latitude::float8, longitude::float8,
		        delivery_fee, free_delivery_threshold, is_active
		 FROM locations
		 WHERE (name ILIKE $1 OR slug ILIKE $1) AND is_active = true
		 ORDER BY name
		 LIMIT 10`,
		"%"+searchTerm+"%",
	)
	if err != nil {
		log.Printf("Error searching stores: %v", err)
		return nil
	}
	defer rows.Close()

	var stores []Location
	for rows.Next() {
		l := Location{}
		if err := rows.Scan(&l.ID, &l.Name, &l.Address, &l.Latitude, &l.Longitude,
			&l.DeliveryFee, &l.FreeDeliveryThreshold, &l.IsActive); err != nil {
			log.Printf("Error scanning location: %v", err)
			continue
		}
		stores = append(stores, l)
	}
	return stores
}

func (s *Service) getStoreMenu(ctx context.Context, locationID string) []Category {
	// Load categories
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, description
		 FROM categories
		 WHERE location_id = $1 AND is_active = true
		 ORDER BY sort_order`,
		locationID,
	)
	if err != nil {
		log.Printf("Error getting store menu: %v", err)
		return nil
	}
	var categories []Category
	for rows.Next() {
		c := Category{}
		if err := rows.Scan(&c.ID, &c.Name, &c.Description); err != nil {
			log.Printf("Error scanning category: %v", err)
			continue
		}
		categories = append(categories, c)
	}
	rows.Close()

	// For each category, load items + their variations + options
	for i := range categories {
		items, err := s.loadItemsForCategory(ctx, categories[i].ID)
		if err != nil {
			log.Printf("Error loading items for category %s: %v", categories[i].ID, err)
			continue
		}
		categories[i].Items = items
	}
	return categories
}

func (s *Service) loadItemsForCategory(ctx context.Context, categoryID string) ([]Item, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, description, price::float8, preparation_time
		 FROM items
		 WHERE category_id = $1 AND is_active = true
		 ORDER BY sort_order, name`,
		categoryID,
	)
	if err != nil {
		return nil, err
	}
	var items []Item
	for rows.Next() {
		it := Item{}
		if err := rows.Scan(&it.ID, &it.Name, &it.Description, &it.Price, &it.PreparationTime); err != nil {
			log.Printf("Error scanning item: %v", err)
			continue
		}
		items = append(items, it)
	}
	rows.Close()

	for i := range items {
		vars, err := s.loadVariations(ctx, items[i].ID)
		if err != nil {
			log.Printf("Error loading variations for item %s: %v", items[i].ID, err)
			continue
		}
		items[i].ItemVariations = vars
	}
	return items, nil
}

func (s *Service) loadVariations(ctx context.Context, itemID string) ([]ItemVariation, error) {
	// Variations are modeled as modifier_groups (group) + modifiers (options).
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, is_required FROM modifier_groups WHERE item_id = $1 ORDER BY sort_order`,
		itemID,
	)
	if err != nil {
		return nil, err
	}
	var vars []ItemVariation
	for rows.Next() {
		v := ItemVariation{}
		if err := rows.Scan(&v.ID, &v.Name, &v.IsRequired); err != nil {
			log.Printf("Error scanning variation: %v", err)
			continue
		}
		vars = append(vars, v)
	}
	rows.Close()

	for i := range vars {
		opts, err := s.loadVariationOptions(ctx, vars[i].ID)
		if err != nil {
			log.Printf("Error loading options for variation %s: %v", vars[i].ID, err)
			continue
		}
		vars[i].ItemVariationOptions = opts
	}
	return vars, nil
}

func (s *Service) loadVariationOptions(ctx context.Context, variationID string) ([]ItemVariationOption, error) {
	// modifiers store price_delta_cents (cents); convert to dollars.
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, COALESCE(price_delta_cents, 0)
		 FROM modifiers WHERE modifier_group_id = $1 AND is_active = true ORDER BY sort_order`,
		variationID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var opts []ItemVariationOption
	for rows.Next() {
		o := ItemVariationOption{}
		var priceDeltaCents int64
		if err := rows.Scan(&o.ID, &o.Name, &priceDeltaCents); err != nil {
			log.Printf("Error scanning option: %v", err)
			continue
		}
		o.PriceModifier = float64(priceDeltaCents) / 100.0
		opts = append(opts, o)
	}
	return opts, nil
}

func (s *Service) getMenuItem(ctx context.Context, itemID string) *Item {
	it := &Item{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, description, price::float8, preparation_time
		 FROM items WHERE id = $1 AND is_active = true`,
		itemID,
	).Scan(&it.ID, &it.Name, &it.Description, &it.Price, &it.PreparationTime)
	if err != nil {
		log.Printf("Error getting menu item: %v", err)
		return nil
	}
	vars, err := s.loadVariations(ctx, it.ID)
	if err != nil {
		log.Printf("Error loading variations: %v", err)
	}
	it.ItemVariations = vars
	return it
}

func (s *Service) addToCart(ctx context.Context, customerID, locationID, itemID string, quantity int, variations map[string]string, specialInstructions string) bool {
	var price float64
	err := s.pool.QueryRow(ctx, `SELECT price::float8 FROM items WHERE id = $1`, itemID).Scan(&price)
	if err != nil {
		log.Printf("Error getting item for cart: %v", err)
		return false
	}
	totalPrice := price * float64(quantity)

	// Sum variation price modifiers. variations is keyed
	// modifier_group_id -> modifier_id; price lives on modifiers as
	// price_delta_cents (cents), converted to dollars here.
	for _, optionID := range variations {
		var priceDeltaCents int64
		if err := s.pool.QueryRow(ctx,
			`SELECT COALESCE(price_delta_cents, 0) FROM modifiers WHERE id = $1`,
			optionID,
		).Scan(&priceDeltaCents); err == nil {
			totalPrice += (float64(priceDeltaCents) / 100.0) * float64(quantity)
		}
	}

	var specialInstructionsArg interface{}
	if specialInstructions != "" {
		specialInstructionsArg = specialInstructions
	} else {
		specialInstructionsArg = nil
	}

	var cartItemID string
	err = s.pool.QueryRow(ctx,
		`INSERT INTO cart_items
		   (customer_id, location_id, item_id, quantity, unit_price, total_price, special_instructions)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id`,
		customerID, locationID, itemID, quantity, price, totalPrice, specialInstructionsArg,
	).Scan(&cartItemID)
	if err != nil {
		log.Printf("Error adding to cart: %v", err)
		return false
	}

	// Insert variations. cart_item_variations keeps its own column names:
	// variation_id holds the modifier_group_id, option_id holds the
	// modifier_id, and price_modifier stores the per-option delta in dollars.
	for variationID, optionID := range variations {
		var priceDeltaCents int64
		if err := s.pool.QueryRow(ctx,
			`SELECT COALESCE(price_delta_cents, 0) FROM modifiers WHERE id = $1`,
			optionID,
		).Scan(&priceDeltaCents); err == nil {
			modifier := float64(priceDeltaCents) / 100.0
			_, insErr := s.pool.Exec(ctx,
				`INSERT INTO cart_item_variations (cart_item_id, variation_id, option_id, price_modifier)
				 VALUES ($1, $2, $3, $4)`,
				cartItemID, variationID, optionID, modifier,
			)
			if insErr != nil {
				log.Printf("Error inserting variation: %v", insErr)
			}
		}
	}

	return true
}

func (s *Service) getCartItems(ctx context.Context, customerID, locationID string) []CartItem {
	query := `SELECT ci.id, ci.customer_id, ci.location_id, ci.item_id, ci.quantity,
	                 ci.unit_price::float8, ci.total_price::float8, ci.special_instructions,
	                 i.id, i.name, i.description, i.price::float8
	          FROM cart_items ci
	          JOIN items i ON ci.item_id = i.id
	          WHERE ci.customer_id = $1`
	args := []interface{}{customerID}
	if strings.TrimSpace(locationID) != "" {
		query += ` AND ci.location_id = $2`
		args = append(args, locationID)
	}
	query += ` ORDER BY ci.created_at`

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		log.Printf("Error getting cart items: %v", err)
		return nil
	}
	defer rows.Close()

	var items []CartItem
	for rows.Next() {
		ci := CartItem{Items: &CartItemRef{}}
		if err := rows.Scan(&ci.ID, &ci.CustomerID, &ci.LocationID, &ci.ItemID, &ci.Quantity,
			&ci.UnitPrice, &ci.TotalPrice, &ci.SpecialInstructions,
			&ci.Items.ID, &ci.Items.Name, &ci.Items.Description, &ci.Items.Price); err != nil {
			log.Printf("Error scanning cart item: %v", err)
			continue
		}
		items = append(items, ci)
	}

	// Load variations per item
	for idx := range items {
		// cart_item_variations.variation_id -> modifier_groups.id and
		// option_id -> modifiers.id. price_modifier on cart_item_variations is
		// already stored in dollars.
		varRows, err := s.pool.Query(ctx,
			`SELECT mg.name, m.name, COALESCE(civ.price_modifier, 0)::float8
			 FROM cart_item_variations civ
			 JOIN modifier_groups mg ON civ.variation_id = mg.id
			 JOIN modifiers m ON civ.option_id = m.id
			 WHERE civ.cart_item_id = $1`,
			items[idx].ID,
		)
		if err != nil {
			log.Printf("Error loading cart item variations: %v", err)
			continue
		}
		for varRows.Next() {
			v := CartItemVariation{}
			if err := varRows.Scan(&v.ItemVariations.Name, &v.ItemVariationOptions.Name, &v.ItemVariationOptions.PriceModifier); err != nil {
				log.Printf("Error scanning cart variation: %v", err)
				continue
			}
			items[idx].CartItemVariations = append(items[idx].CartItemVariations, v)
		}
		varRows.Close()
	}

	return items
}

func (s *Service) clearCart(ctx context.Context, customerID, locationID string) bool {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM cart_items WHERE customer_id = $1 AND location_id = $2`,
		customerID, locationID,
	)
	if err != nil {
		log.Printf("Error clearing cart: %v", err)
		return false
	}
	return true
}

func (s *Service) getCartSummary(ctx context.Context, customerID, locationID string) *CartSummary {
	cs := &CartSummary{}
	err := s.pool.QueryRow(ctx,
		`SELECT customer_id, location_id, item_count, total_quantity,
		        subtotal::float8, delivery_fee::float8, delivery_fee_amount::float8, total_amount::float8
		 FROM cart_summary WHERE customer_id = $1 AND location_id = $2`,
		customerID, locationID,
	).Scan(&cs.CustomerID, &cs.LocationID, &cs.ItemCount, &cs.TotalQuantity,
		&cs.Subtotal, &cs.DeliveryFee, &cs.DeliveryFeeAmount, &cs.TotalAmount)
	if err != nil {
		log.Printf("Error getting cart summary: %v", err)
		return nil
	}
	return cs
}

func valueAt(values []interface{}, idx map[string]int, key string) (interface{}, bool) {
	i, ok := idx[key]
	if !ok {
		return nil, false
	}
	if i >= len(values) {
		return nil, false
	}
	return values[i], true
}

func (s *Service) deletePaymentMethod(ctx context.Context, customerID, paymentMethodID string) (bool, string) {
	_, err := s.pool.Exec(ctx,
		`SELECT deactivate_payment_method($1, $2)`,
		customerID, paymentMethodID,
	)
	if err != nil {
		log.Printf("Error deleting payment method: %v", err)
		return false, err.Error()
	}
	return true, ""
}

func (s *Service) setDefaultPaymentMethod(ctx context.Context, customerID, paymentMethodID string) (bool, string) {
	_, err := s.pool.Exec(ctx,
		`SELECT set_default_payment_method($1, $2)`,
		customerID, paymentMethodID,
	)
	if err != nil {
		log.Printf("Error setting default payment method: %v", err)
		return false, err.Error()
	}
	return true, ""
}

func (s *Service) getStoreInfo(ctx context.Context, locationID string) *Location {
	l := &Location{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, address, latitude::float8, longitude::float8,
		        delivery_fee, free_delivery_threshold, is_active
		 FROM locations WHERE id = $1`,
		locationID,
	).Scan(&l.ID, &l.Name, &l.Address, &l.Latitude, &l.Longitude,
		&l.DeliveryFee, &l.FreeDeliveryThreshold, &l.IsActive)
	if err != nil {
		log.Printf("Error getting store info: %v", err)
		return nil
	}
	return l
}

type createOrderResult struct {
	Success     bool
	Error       string
	OrderID     string
	OrderNumber string
	TotalAmount float64
}

type orderAddressData struct {
	Address      string
	Latitude     *float64
	Longitude    *float64
	Instructions *string
}

func (s *Service) createOrder(
	ctx context.Context,
	customerID, locationID, orderType string,
	addressData *orderAddressData,
	tipAmount float64,
	customerEmail string,
) createOrderResult {
	log.Printf("=== CREATING ORDER ===")
	log.Printf("Customer ID: %s Location ID: %s OrderType: %s", customerID, locationID, orderType)

	cartItems := s.getCartItems(ctx, customerID, locationID)
	log.Printf("Cart Items: %d", len(cartItems))
	if len(cartItems) == 0 {
		return createOrderResult{Success: false, Error: "Cart is empty"}
	}

	cartSummary := s.getCartSummary(ctx, customerID, locationID)
	if cartSummary == nil {
		return createOrderResult{Success: false, Error: "Failed to get cart summary"}
	}

	orderNumber := fmt.Sprintf("WA%08d", time.Now().UnixMilli()%100000000)

	subtotal := cartSummary.Subtotal
	deliveryFee := cartSummary.DeliveryFee
	taxRate := 15.00
	taxAmount := subtotal * (taxRate / 100.0)
	totalAmount := subtotal + deliveryFee + tipAmount

	// Resolve per-store currency (5-min in-process cache).
	cur, curErr := locations.CurrencyFor(ctx, s.pool, locationID)
	if curErr != nil {
		log.Printf("chatbot: createOrder: CurrencyFor(%s): %v — defaulting to ZAR", locationID, curErr)
		cur = locations.Currency{Code: "ZAR", Symbol: "R", Decimals: 2}
	}

	// Resolve delivery fields.
	var notes interface{}
	if customerEmail != "" {
		notes = fmt.Sprintf("Customer email: %s", customerEmail)
	}
	var dAddr, dInstr interface{}
	var dLat, dLng interface{}
	if orderType == "delivery" && addressData != nil {
		if addressData.Address != "" {
			dAddr = addressData.Address
		}
		if addressData.Latitude != nil {
			dLat = *addressData.Latitude
		}
		if addressData.Longitude != nil {
			dLng = *addressData.Longitude
		}
		if addressData.Instructions != nil {
			dInstr = *addressData.Instructions
		}
	}

	// Convert financials to integer cents.
	subtotalCents := int64(math.Round(subtotal * 100))
	deliveryFeeCents := int64(math.Round(deliveryFee * 100))
	taxCents := int64(math.Round(taxAmount * 100))
	totalCents := int64(math.Round(totalAmount * 100))

	// Resolve organization_id from the location (required for the orders NOT NULL FK).
	var orgID string
	if err := s.pool.QueryRow(ctx,
		`SELECT organization_id FROM locations WHERE id = $1`,
		locationID,
	).Scan(&orgID); err != nil {
		log.Printf("Error resolving org for location %s: %v", locationID, err)
		return createOrderResult{Success: false, Error: "Failed to resolve organization"}
	}

	var orderID string
	// Wrap in a service-role-scoped transaction: orders and order_items have FORCE
	// RLS and require session vars. The chatbot has no JWT context — service-role
	// is appropriate for this trusted server path; org/location values are explicit.
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Step 1: Insert consolidated order row (order_details + order_financial_details
		// fields are now directly on orders after the Wave 0 consolidation).
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (
			    organization_id, location_id, customer_id, order_number,
			    order_type, fulfillment_type, status,
			    subtotal_cents, delivery_fee_cents, tax_cents, total_cents, tax_rate,
			    currency_code, estimated_prep_time,
			    delivery_address, delivery_latitude, delivery_longitude, delivery_instructions,
			    notes
			)
			VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, $12, 30, $13, $14, $15, $16, $17)
			RETURNING id
		`,
			orgID, locationID, customerID, orderNumber,
			orderType, fulfillmentTypeForChatbot(orderType),
			subtotalCents, deliveryFeeCents, taxCents, totalCents, taxRate,
			cur.Code,
			dAddr, dLat, dLng, dInstr,
			notes,
		).Scan(&orderID); err != nil {
			return fmt.Errorf("insert order: %w", err)
		}

		// Step 2: Insert order_items with integer-cent columns (unit_price/total_price
		// were renamed to unit_price_cents/total_price_cents in the Wave 0 schema).
		for _, ci := range cartItems {
			unitCents := int64(math.Round(ci.UnitPrice * 100))
			totalItemCents := int64(math.Round(ci.TotalPrice * 100))
			var specialInstr interface{}
			if ci.SpecialInstructions != nil {
				specialInstr = *ci.SpecialInstructions
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_items (order_id, item_id, quantity, unit_price_cents, total_price_cents, special_instructions)
				VALUES ($1, $2, $3, $4, $5, $6)
			`, orderID, ci.ItemID, ci.Quantity, unitCents, totalItemCents, specialInstr,
			); err != nil {
				return fmt.Errorf("insert order item %s: %w", ci.ItemID, err)
			}
		}
		return nil
	})
	if err != nil {
		log.Printf("Error creating order: %v", err)
		return createOrderResult{Success: false, Error: "Failed to create order"}
	}

	// Step 3: clear cart
	s.clearCart(ctx, customerID, locationID)

	return createOrderResult{
		Success:     true,
		OrderID:     orderID,
		OrderNumber: orderNumber,
		TotalAmount: totalAmount,
	}
}

// fulfillmentTypeForChatbot maps the chatbot's order_type string to the
// fulfillment_type enum used by the consolidated orders table.
func fulfillmentTypeForChatbot(orderType string) string {
	switch orderType {
	case "delivery":
		return "delivery"
	case "dine_in":
		return "dine_in"
	default:
		return "collection"
	}
}

type addAddressResult struct {
	Success bool
	Error   string
	Address *CustomerAddress
}

func (s *Service) addCustomerAddress(ctx context.Context, customerID, address string, latitude, longitude float64, isDefault bool) addAddressResult {
	if isDefault {
		_, _ = s.pool.Exec(ctx,
			`UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`,
			customerID,
		)
	}
	newAddr := &CustomerAddress{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO customer_addresses
		    (customer_id, address_line_1, latitude, longitude, is_default)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, customer_id, address_line_1, latitude::text, longitude::text, delivery_instructions, is_default`,
		customerID, address, latitude, longitude, isDefault,
	).Scan(&newAddr.ID, &newAddr.CustomerID, &newAddr.AddressLine1, &newAddr.Latitude,
		&newAddr.Longitude, &newAddr.DeliveryInstructions, &newAddr.IsDefault)
	if err != nil {
		log.Printf("Error adding customer address: %v", err)
		return addAddressResult{Success: false, Error: err.Error()}
	}
	return addAddressResult{Success: true, Address: newAddr}
}

func (s *Service) deleteCustomerAddress(ctx context.Context, customerID, addressID string) (bool, string) {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM customer_addresses WHERE customer_id = $1 AND id = $2`,
		customerID, addressID,
	)
	if err != nil {
		log.Printf("Error deleting customer address: %v", err)
		return false, err.Error()
	}
	return true, ""
}

func (s *Service) getCustomerAddress(ctx context.Context, customerID, addressID string) *CustomerAddress {
	a := &CustomerAddress{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, customer_id, address_line_1, latitude::text, longitude::text,
		        delivery_instructions, is_default
		 FROM customer_addresses WHERE customer_id = $1 AND id = $2`,
		customerID, addressID,
	).Scan(&a.ID, &a.CustomerID, &a.AddressLine1, &a.Latitude,
		&a.Longitude, &a.DeliveryInstructions, &a.IsDefault)
	if err != nil {
		log.Printf("Error getting customer address: %v", err)
		return nil
	}
	return a
}

func (s *Service) setDefaultAddress(ctx context.Context, customerID, addressID string) (bool, string) {
	_, _ = s.pool.Exec(ctx,
		`UPDATE customer_addresses SET is_default = false WHERE customer_id = $1`,
		customerID,
	)
	_, err := s.pool.Exec(ctx,
		`UPDATE customer_addresses SET is_default = true WHERE id = $1 AND customer_id = $2`,
		addressID, customerID,
	)
	if err != nil {
		log.Printf("Error setting default address: %v", err)
		return false, "Failed to set default address"
	}
	return true, ""
}

func (s *Service) getActiveOrdersCount(ctx context.Context, customerID string) int {
	var cnt int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM orders
		 WHERE customer_id = $1
		   AND status IN ('pending','confirmed','preparing','ready','out_for_delivery')`,
		customerID,
	).Scan(&cnt)
	if err != nil {
		log.Printf("Error getting active orders count: %v", err)
		return 0
	}
	return cnt
}

func (s *Service) getCustomerProfile(ctx context.Context, customerID string) *Customer {
	c := &Customer{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, whatsapp_number, first_name, last_name, email, created_at
		 FROM customers WHERE id = $1`,
		customerID,
	).Scan(&c.ID, &c.WhatsappNumber, &c.FirstName, &c.LastName, &c.Email, &c.CreatedAt)
	if err != nil {
		log.Printf("Error getting customer profile: %v", err)
		return nil
	}
	return c
}

type profileUpdates struct {
	FirstName *string
	LastName  *string
	Email     *string
}

type updateProfileResult struct {
	Success  bool
	Error    string
	Customer *Customer
}

func (s *Service) updateCustomerProfile(ctx context.Context, customerID string, updates profileUpdates) updateProfileResult {
	// Build dynamic SQL
	setClauses := []string{}
	args := []interface{}{}
	argN := 1
	if updates.FirstName != nil {
		setClauses = append(setClauses, fmt.Sprintf("first_name = $%d", argN))
		args = append(args, *updates.FirstName)
		argN++
	}
	if updates.LastName != nil {
		setClauses = append(setClauses, fmt.Sprintf("last_name = $%d", argN))
		args = append(args, *updates.LastName)
		argN++
	}
	if updates.Email != nil {
		setClauses = append(setClauses, fmt.Sprintf("email = $%d", argN))
		args = append(args, *updates.Email)
		argN++
	}
	setClauses = append(setClauses, "updated_at = NOW()")
	args = append(args, customerID)

	sqlStmt := fmt.Sprintf(
		`UPDATE customers SET %s WHERE id = $%d
		 RETURNING id, whatsapp_number, first_name, last_name, email, created_at`,
		strings.Join(setClauses, ", "), argN,
	)

	c := &Customer{}
	err := s.pool.QueryRow(ctx, sqlStmt, args...).Scan(
		&c.ID, &c.WhatsappNumber, &c.FirstName, &c.LastName, &c.Email, &c.CreatedAt,
	)
	if err != nil {
		log.Printf("Error updating customer profile: %v", err)
		return updateProfileResult{Success: false, Error: err.Error()}
	}
	return updateProfileResult{Success: true, Customer: c}
}
