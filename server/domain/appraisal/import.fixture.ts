// server/domain/appraisal/import.fixture.ts — a small UAD 3.6 file for tests.
//
// Hand-written in the shape of the GSE sample files (Appendix D-1), with only
// the elements the importer reads. The GSE samples themselves are not checked
// in: they are the GSEs' copyrighted documents, and a fixture you can read top
// to bottom is a better test anyway.
//
// The comparable is the point. It carries the same field names as the subject
// with different values — 1950, 2,400 sq ft, a $9,999 defect — so any reader
// that takes "the first YearBuilt in the file" instead of the subject's fails
// the tests loudly.

export const UAD36_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Test fixture: not a real appraisal. -->
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas" xmlns:gse="http://www.datamodelextension.org" xmlns:xlink="http://www.w3.org/1999/xlink" MISMOReferenceModelIdentifier="3.6.0366">
 <DOCUMENT_SETS><DOCUMENT_SET><DOCUMENTS><DOCUMENT><DEAL_SETS><DEAL_SET><DEALS><DEAL><SERVICES><SERVICE>
 <VALUATION><VALUATION_RESPONSE><VALUATION_ANALYSES><VALUATION_ANALYSIS>
  <PROPERTIES>
   <PROPERTY ValuationUseType="SalesComparable" xlink:label="PROPERTY_COMP1">
    <ADDRESS><AddressLineText>99 Elsewhere Ave</AddressLineText><CityName>Kill Devil Hills</CityName><StateCode>NC</StateCode><PostalCode>27948</PostalCode></ADDRESS>
    <IMPROVEMENTS><IMPROVEMENT><IMPROVEMENT_DETAIL><PropertyStructureBuiltYear>1950</PropertyStructureBuiltYear></IMPROVEMENT_DETAIL></IMPROVEMENT></IMPROVEMENTS>
    <PROPERTY_UNITS><PROPERTY_UNIT><PROPERTY_UNIT_AREA><UnitStandardAboveGradeFinishedAreaMeasure>2400</UnitStandardAboveGradeFinishedAreaMeasure></PROPERTY_UNIT_AREA>
     <PROPERTY_UNIT_DETAIL><BedroomCount>5</BedroomCount><FullBathroomCount>4</FullBathroomCount></PROPERTY_UNIT_DETAIL></PROPERTY_UNIT></PROPERTY_UNITS>
    <PROPERTY_DEFECT><DEFECTS><DEFECT><DEFECT_DETAIL><DefectItemDescription>Comparable's cracked slab</DefectItemDescription><DefectItemEstimatedCostToRepairAmount>9999</DefectItemEstimatedCostToRepairAmount></DEFECT_DETAIL></DEFECT></DEFECTS></PROPERTY_DEFECT>
   </PROPERTY>
   <PROPERTY ValuationUseType="SubjectProperty">
    <ADDRESS><AddressLineText>12 Test St</AddressLineText><CityName>Kill Devil Hills</CityName><StateCode>NC</StateCode><PostalCode>27948</PostalCode></ADDRESS>
    <PROPERTY_DETAIL><OverallConditionRatingCode>C3</OverallConditionRatingCode><OverallQualityRatingCode>Q4</OverallQualityRatingCode><AccessoryDwellingUnitTotalCount>0</AccessoryDwellingUnitTotalCount></PROPERTY_DETAIL>
    <PARCELS><PARCEL><PARCEL_IDENTIFICATIONS><PARCEL_IDENTIFICATION><ParcelIdentifier>989617-12-3456</ParcelIdentifier></PARCEL_IDENTIFICATION></PARCEL_IDENTIFICATIONS></PARCEL></PARCELS>
    <SITE>
     <SITE_SIZE_LAYOUT><LotSizeAreaMeasure AreaUnitOfMeasureType="Acres">0.25</LotSizeAreaMeasure></SITE_SIZE_LAYOUT>
     <HAZARD_ZONES><HAZARD_ZONE><HazardZoneType>FEMASpecialFloodHazardArea</HazardZoneType></HAZARD_ZONE></HAZARD_ZONES>
     <SITE_UTILITIES>
      <SITE_UTILITY><SITE_UTILITY_DETAIL><SiteUtilityOwnershipType>Public</SiteUtilityOwnershipType><UtilityType>Water</UtilityType></SITE_UTILITY_DETAIL></SITE_UTILITY>
      <SITE_UTILITY><SITE_UTILITY_DETAIL><SiteUtilityOwnershipType>NonPublic</SiteUtilityOwnershipType><UtilityType>SanitarySewer</UtilityType></SITE_UTILITY_DETAIL></SITE_UTILITY>
     </SITE_UTILITIES>
     <SITE_ZONING><SITE_ZONING_DETAIL><SiteZoningClassificationIdentifier>RS-1</SiteZoningClassificationIdentifier><SiteZoningComplianceType>Legal</SiteZoningComplianceType></SITE_ZONING_DETAIL></SITE_ZONING>
    </SITE>
    <IMPROVEMENTS><IMPROVEMENT>
     <IMPROVEMENT_DETAIL><PropertyStructureBuiltYear>2018</PropertyStructureBuiltYear></IMPROVEMENT_DETAIL>
     <STRUCTURE><STRUCTURE_COMPONENTS><STRUCTURE_COMPONENT><ROOF><ROOF_DETAIL><RoofEstimatedAgeRangeType>OneToTenYears</RoofEstimatedAgeRangeType></ROOF_DETAIL>
      <ROOF_MATERIALS><ROOF_MATERIAL><RoofMaterialType>Asphalt</RoofMaterialType></ROOF_MATERIAL></ROOF_MATERIALS></ROOF></STRUCTURE_COMPONENT></STRUCTURE_COMPONENTS></STRUCTURE>
     <SYSTEM><HEATING_SYSTEMS><HEATING_SYSTEM><HeatingFuelType>Electricity</HeatingFuelType><HeatingSystemType>HeatPump</HeatingSystemType></HEATING_SYSTEM></HEATING_SYSTEMS></SYSTEM>
     <CAR_STORAGES><CAR_STORAGE><CAR_STORAGE_DETAIL><CarStorageType>Carport</CarStorageType><ParkingSpacesCount>2</ParkingSpacesCount></CAR_STORAGE_DETAIL></CAR_STORAGE></CAR_STORAGES>
    </IMPROVEMENT></IMPROVEMENTS>
    <PROPERTY_UNITS><PROPERTY_UNIT>
     <PROPERTY_UNIT_AREA><UnitStandardAboveGradeFinishedAreaMeasure>1842</UnitStandardAboveGradeFinishedAreaMeasure><UnitNonStandardAboveGradeFinishedAreaMeasure>410</UnitNonStandardAboveGradeFinishedAreaMeasure></PROPERTY_UNIT_AREA>
     <PROPERTY_UNIT_DETAIL><BedroomCount>3</BedroomCount><FullBathroomCount>2</FullBathroomCount><HalfBathroomCount>1</HalfBathroomCount></PROPERTY_UNIT_DETAIL>
     <ROOMS><ROOM><ROOM_DETAIL><RoomType>Kitchen</RoomType><RoomUpdateStatusType>FullyUpdated</RoomUpdateStatusType><RoomUpdatedTimeframeType>OneToFiveYears</RoomUpdatedTimeframeType></ROOM_DETAIL></ROOM></ROOMS>
    </PROPERTY_UNIT></PROPERTY_UNITS>
    <ENERGY_EFFICIENCY_AND_GREEN><RenewableEnergyComponentExistsIndicator>false</RenewableEnergyComponentExistsIndicator></ENERGY_EFFICIENCY_AND_GREEN>
    <DISASTER_MITIGATION_FEATURES><DISASTER_MITIGATION_FEATURE><DisasterMitigationFeatureType>ImpactResistantGlass</DisasterMitigationFeatureType></DISASTER_MITIGATION_FEATURE></DISASTER_MITIGATION_FEATURES>
    <PROPERTY_DEFECT><DEFECTS>
     <DEFECT><DEFECT_DETAIL><DefectComponentLabelType>Roof</DefectComponentLabelType><DefectItemAffectsSoundnessStructuralIntegrityIndicator>false</DefectItemAffectsSoundnessStructuralIntegrityIndicator>
      <DefectItemDescription>Missing shingles on the rear slope &amp; minor flashing gaps</DefectItemDescription><DefectItemEstimatedCostToRepairAmount>1200</DefectItemEstimatedCostToRepairAmount>
      <DefectItemLocationType>Other</DefectItemLocationType><DefectItemLocationTypeOtherDescription>Rear slope</DefectItemLocationTypeOtherDescription><DefectItemRecommendedActionType>Repair</DefectItemRecommendedActionType></DEFECT_DETAIL></DEFECT>
     <DEFECT><DEFECT_DETAIL><DefectComponentLabelType>Other</DefectComponentLabelType><DefectComponentLabelTypeOtherDescription>Deck</DefectComponentLabelTypeOtherDescription>
      <DefectItemAffectsSoundnessStructuralIntegrityIndicator>true</DefectItemAffectsSoundnessStructuralIntegrityIndicator><DefectItemDescription>Soft decking at the stair landing</DefectItemDescription>
      <DefectItemRecommendedActionType>Inspection</DefectItemRecommendedActionType></DEFECT_DETAIL></DEFECT>
    </DEFECTS></PROPERTY_DEFECT>
   </PROPERTY>
  </PROPERTIES>
  <VALUATION_REPORT>
   <SCOPE_OF_WORK><SCOPE_OF_WORK_DETAIL><ValuationAssignmentType>Refinance</ValuationAssignmentType></SCOPE_OF_WORK_DETAIL></SCOPE_OF_WORK>
   <VALUATION_REPORT_DETAIL><MeasurementStandardPublisherType>AmericanNationalStandardsInstitute</MeasurementStandardPublisherType></VALUATION_REPORT_DETAIL>
   <VALUATION_RECONCILIATION><VALUATION_RECONCILIATION_SUMMARY>
    <VALUATION_CONDITIONS><VALUATION_CONDITION><PropertyValuationConditionalConclusionType>AsIs</PropertyValuationConditionalConclusionType></VALUATION_CONDITION></VALUATION_CONDITIONS>
    <VALUATION_RECONCILIATION_SUMMARY_DETAIL><AppraisalReportEffectiveDate>2026-10-04</AppraisalReportEffectiveDate><OpinionOfValueAmount>612000</OpinionOfValueAmount></VALUATION_RECONCILIATION_SUMMARY_DETAIL>
   </VALUATION_RECONCILIATION_SUMMARY></VALUATION_RECONCILIATION>
  </VALUATION_REPORT>
 </VALUATION_ANALYSIS></VALUATION_ANALYSES></VALUATION_RESPONSE></VALUATION>
 </SERVICE></SERVICES></DEAL></DEALS></DEAL_SET></DEAL_SETS></DOCUMENT></DOCUMENTS></DOCUMENT_SET></DOCUMENT_SETS>
</MESSAGE>
`;

/** Enough of a PDF to pass the upload pipeline's magic-byte check. */
export const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);

/** The page text pdftotext -layout produces for a redesigned URAR, trimmed to the parts read. */
export const URAR_PDF_TEXT = `
                         Uniform Residential Appraisal Report
 Opinion of Market Value           $612,000                        Market Value Condition               As Is
 Effective Date of Appraisal       10/04/2026                      Property Valuation Method            Traditional Appraisal
 Construction Method               Site Built                      Overall Quality                      Q4
 Attachment Type                   Detached                        Overall Condition                    C3
 Zoning Compliance                 Legal
 Total Site Size                            10,890 Sq. Ft.                    Number of Parcels                     1
 Year Built                    2018
 Foundation                        Pilings                                                           Typical Wear and Tear
 Roof                              Asphalt                                                           New or Like New
 Heating             Heat Pump                Electricity                            Core Heating System Below Grade
 Cooling             Centralized
   Finished Above Grade                           1,842 Sq. Ft.                      Occupancy                                   Tenant
   Unfinished Above Grade                         0 Sq. Ft.                          Total Bedrooms                              3
   Finished Below Grade                           0 Sq. Ft.                          Total Bathrooms - Full                      2
   Unfinished Below Grade                         0 Sq. Ft.                          Total Bathrooms - Half                      1
 ${"Comparable sales filler text. ".repeat(10)}
 Year Built                                               2018                 1950              $0
 Finished Area Above Grade                       1,842 Sq. Ft.         2,400 Sq. Ft.         $4,500
`;
