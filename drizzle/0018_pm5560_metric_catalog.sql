INSERT INTO "metric_definitions" ("key","name","category","unit","data_type","aggregation")
VALUES
  ('electrical.voltage.l1_n','Voltaje L1-N','electrical.voltage','V','float','avg'),
  ('electrical.voltage.l2_n','Voltaje L2-N','electrical.voltage','V','float','avg'),
  ('electrical.voltage.l3_n','Voltaje L3-N','electrical.voltage','V','float','avg'),
  ('electrical.voltage.l1_l2','Voltaje L1-L2','electrical.voltage','V','float','avg'),
  ('electrical.voltage.l2_l3','Voltaje L2-L3','electrical.voltage','V','float','avg'),
  ('electrical.voltage.l3_l1','Voltaje L3-L1','electrical.voltage','V','float','avg'),
  ('electrical.current.l1','Corriente L1','electrical.current','A','float','avg'),
  ('electrical.current.l2','Corriente L2','electrical.current','A','float','avg'),
  ('electrical.current.l3','Corriente L3','electrical.current','A','float','avg'),
  ('electrical.power.active.total','Potencia activa total','electrical.power','kW','float','avg'),
  ('electrical.power.reactive.total','Potencia reactiva total','electrical.power','kVAr','float','avg'),
  ('electrical.power.apparent.total','Potencia aparente total','electrical.power','kVA','float','avg'),
  ('electrical.power_factor','Factor de potencia','electrical.power','','float','avg'),
  ('electrical.frequency','Frecuencia','electrical.frequency','Hz','float','avg'),
  ('electrical.energy.import','Energía importada','electrical.energy','kWh','float','counter'),
  ('electrical.energy.export','Energía exportada','electrical.energy','kWh','float','counter'),
  ('electrical.demand.active','Demanda activa','electrical.demand','kW','float','max')
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "unit" = EXCLUDED."unit",
  "data_type" = EXCLUDED."data_type",
  "aggregation" = EXCLUDED."aggregation",
  "updated_at" = now();